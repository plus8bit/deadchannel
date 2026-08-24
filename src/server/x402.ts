/**
 * x402 v2 protocol layer for a selling resource server.
 *
 * Wire format follows the HTTP transport spec: the PaymentRequired object
 * travels base64-encoded in the `PAYMENT-REQUIRED` response header, the buyer
 * echoes a signed PaymentPayload in `PAYMENT-SIGNATURE`, and the settlement
 * result comes back in `PAYMENT-RESPONSE`. Bodies carry no protocol data.
 */

import { algorandOption } from "./algorand.ts";
import { robinhoodOption } from "./robinhood.ts";
import type { Config } from "./config.ts";

export const HEADER_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_RESPONSE = "PAYMENT-RESPONSE";

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  /** Printable ASCII, max 32 characters — longer names are dropped by indexers. */
  serviceName?: string;
  /** Max 5 entries, each max 32 characters. */
  tags?: string[];
  iconUrl?: string;
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

export interface PaymentPayload {
  x402Version: number;
  resource?: unknown;
  accepted?: PaymentRequirements;
  payload?: unknown;
  extensions?: Record<string, unknown>;
}

/** Everything a paid route advertises about itself, including for discovery. */
export interface PaidRoute {
  path: string;
  method: string;
  description: string;
  serviceName: string;
  tags: string[];
  mimeType: string;
  /** Concrete example request, shown to agents so they can call it correctly. */
  inputExample: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputExample: Record<string, unknown>;
}

const MAX_SERVICE_NAME = 32;
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 32;

export function buildPaymentRequired(
  cfg: Config,
  route: PaidRoute,
  error = "PAYMENT-SIGNATURE header is required",
): PaymentRequired {
  return {
    x402Version: 2,
    error,
    resource: {
      url: `${cfg.publicUrl}${route.path}`,
      description: route.description,
      mimeType: route.mimeType,
      serviceName: clampAscii(route.serviceName, MAX_SERVICE_NAME),
      tags: route.tags.slice(0, MAX_TAGS).map((t) => clampAscii(t, MAX_TAG_LENGTH)),
    },
    accepts: [
      {
        scheme: "exact",
        network: cfg.network.caip2,
        amount: cfg.priceAtomic,
        asset: cfg.network.usdc,
        payTo: cfg.payTo,
        maxTimeoutSeconds: cfg.maxTimeoutSeconds,
        extra: { name: cfg.network.usdcName, version: cfg.network.usdcVersion },
      },
      // A second chain is offered, not substituted. A buyer holding USDC on
      // only one of them can still pay, and one that holds both picks for
      // itself; the price is identical either way.
      ...(cfg.algorandPayTo
        ? [algorandOption({ payTo: cfg.algorandPayTo, testnet: cfg.network.testnet }, cfg.priceAtomic, cfg.maxTimeoutSeconds)]
        : []),
      ...(cfg.robinhoodPayTo && !cfg.network.testnet
        ? [robinhoodOption(cfg.robinhoodPayTo, cfg.priceAtomic, cfg.maxTimeoutSeconds)]
        : []),
    ],
    extensions: bazaarExtension(route),
  };
}

/**
 * Bazaar discovery extension.
 *
 * This is what gets the resource indexed and, more importantly, *searchable*.
 * 89.8% of the live catalog ships without it, which is why agents cannot find
 * most of what is out there — so this service publishes the full descriptor.
 */
export function bazaarExtension(route: PaidRoute): Record<string, unknown> {
  return {
    bazaar: {
      info: {
        input: {
          type: "http",
          method: route.method,
          bodyType: "json",
          body: route.inputExample,
        },
        output: {
          type: "json",
          example: route.outputExample,
        },
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          input: { type: "object", properties: { body: route.inputSchema } },
          output: { type: "object" },
        },
      },
    },
  };
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/** Tolerant of raw JSON as well as base64, because some clients send either. */
export function decodePaymentSignature(header: string | undefined): PaymentPayload | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;

  const candidates = trimmed.startsWith("{")
    ? [trimmed]
    : [safeBase64(trimmed), trimmed].filter((v): v is string => v !== null);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as PaymentPayload;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next representation.
    }
  }
  return null;
}

function safeBase64(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return decoded.trimStart().startsWith("{") ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Confirm the buyer signed for what we actually asked for.
 *
 * The facilitator validates the signature, not the terms. Without this check a
 * buyer could authorize one cent to a different address and still be verified.
 */
/**
 * The offer the buyer actually chose.
 *
 * Once a resource advertises more than one chain, assuming the first entry is
 * wrong for everyone who picked the second: their payment would be checked
 * against terms they never agreed to and rejected as a mismatch. The payload
 * names the network and scheme it was signed for, so the offer is looked up by
 * those rather than by position.
 *
 * Falls back to the first entry when nothing matches, so the caller still gets
 * terms to compare against and produces a specific mismatch reason instead of
 * a bare failure.
 */
export function selectTerms(
  accepts: PaymentRequirements[],
  payload: PaymentPayload | null,
): PaymentRequirements | undefined {
  const wanted = payload?.accepted;
  if (!wanted) return accepts[0];
  return (
    accepts.find((o) => o.network === wanted.network && o.scheme === wanted.scheme) ?? accepts[0]
  );
}

export function matchesOurTerms(
  accepted: PaymentRequirements | undefined,
  ours: PaymentRequirements,
): { ok: true } | { ok: false; reason: string } {
  if (!accepted) return { ok: false, reason: "payment payload has no accepted terms" };
  if (accepted.scheme !== ours.scheme) return { ok: false, reason: `scheme must be ${ours.scheme}` };
  if (accepted.network !== ours.network) return { ok: false, reason: `network must be ${ours.network}` };
  if (accepted.amount !== ours.amount) return { ok: false, reason: `amount must be ${ours.amount}` };
  if (!sameAddress(accepted.asset, ours.asset)) return { ok: false, reason: "asset does not match" };
  if (!sameAddress(accepted.payTo, ours.payTo)) return { ok: false, reason: "payTo does not match" };
  return { ok: true };
}

function sameAddress(a: string | undefined, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

/** Indexers silently drop non-ASCII or over-long values, so clamp before sending. */
function clampAscii(value: string, max: number): string {
  return value.replace(/[^\x20-\x7E]/g, "").slice(0, max);
}
