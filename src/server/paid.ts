import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "./config.ts";
import { USDC_DECIMALS, toAtomic } from "./config.ts";
import { FacilitatorClient } from "./facilitator.ts";
import type { PaidRoute } from "./x402.ts";
import {
  HEADER_REQUIRED,
  HEADER_RESPONSE,
  HEADER_SIGNATURE,
  buildPaymentRequired,
  decodePaymentSignature,
  encodeHeader,
  matchesOurTerms,
} from "./x402.ts";

/**
 * The payment flow, once, for any paid route.
 *
 * Extracted so a second product does not reimplement the part where money
 * moves. The order is fixed by the spec's authorization flow — verify, run the
 * resource, settle — and the one rule worth restating is that settlement
 * happens only after the handler returned a result, so a failure on our side
 * costs the buyer nothing.
 */

export interface PaidHandlerDeps<Req, Res> {
  route: PaidRoute;
  /** Reads and validates the request body. Throws BadInput to reject. */
  parse: (body: unknown) => Req;
  /** Produces the thing being sold. Throwing means no settlement. */
  run: (req: Req) => Promise<Res>;
  /** Per-route price override, when a shop sells several things. */
  priceUsd?: number;
}

export class BadInput extends Error {}

const MAX_BODY_BYTES = 32 * 1024;

export interface PaidOutcome {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  /** Present only when a payment actually settled. */
  settled?: { transaction: string; payer?: string | undefined; priceUsd: number };
}

export async function servePaid<Req, Res>(
  req: IncomingMessage,
  cfg: Config,
  facilitator: FacilitatorClient,
  deps: PaidHandlerDeps<Req, Res>,
): Promise<PaidOutcome> {
  const priced = deps.priceUsd === undefined ? cfg : withPrice(cfg, deps.priceUsd);
  const required = buildPaymentRequired(priced, deps.route);
  const terms = required.accepts[0];
  if (!terms) return { status: 500, body: { error: "no payment terms configured" }, headers: {} };

  const signature = decodePaymentSignature(header(req, HEADER_SIGNATURE));
  if (!signature) {
    return {
      status: 402,
      headers: { [HEADER_REQUIRED]: encodeHeader(required) },
      body: {
        error: "payment required",
        price: `$${priced.priceUsd}`,
        network: priced.network.label,
        hint: `send a signed PaymentPayload in the ${HEADER_SIGNATURE} header`,
      },
    };
  }

  let request: Req;
  try {
    request = deps.parse(await readJson(req));
  } catch (err) {
    return {
      status: 400,
      headers: {},
      body: { error: err instanceof BadInput ? err.message : "body must be valid JSON" },
    };
  }

  const agreed = matchesOurTerms(signature.accepted, terms);
  if (!agreed.ok) {
    return {
      status: 402,
      headers: { [HEADER_REQUIRED]: encodeHeader(buildPaymentRequired(priced, deps.route, agreed.reason)) },
      body: { error: "payment terms mismatch", reason: agreed.reason },
    };
  }

  let verification;
  try {
    verification = await facilitator.verify(signature, terms);
  } catch {
    return { status: 502, headers: {}, body: { error: "payment verification unavailable" } };
  }
  if (!verification.isValid) {
    return {
      status: 402,
      headers: { [HEADER_REQUIRED]: encodeHeader(required) },
      body: { error: "payment invalid", reason: verification.invalidReason ?? "unknown" },
    };
  }

  let result: Res;
  try {
    result = await deps.run(request);
  } catch {
    // Nothing settles, so the buyer is not charged for our failure.
    return { status: 502, headers: {}, body: { error: "request failed, you were not charged" } };
  }

  let settlement;
  try {
    settlement = await facilitator.settle(signature, terms);
  } catch {
    return { status: 502, headers: {}, body: { error: "settlement unavailable, you were not charged" } };
  }
  if (!settlement.success) {
    return {
      status: 402,
      headers: { [HEADER_RESPONSE]: encodeHeader(settlement) },
      body: { error: "settlement failed", reason: settlement.errorReason ?? "unknown" },
    };
  }

  return {
    status: 200,
    headers: { [HEADER_RESPONSE]: encodeHeader(settlement) },
    body: result,
    settled: {
      transaction: settlement.transaction,
      payer: settlement.payer ?? verification.payer,
      priceUsd: priced.priceUsd,
    },
  };
}

/**
 * A shop with several SKUs needs the terms to carry each one's own price.
 * The conversion goes through the same `toAtomic` the boot config uses —
 * money arithmetic written twice is money arithmetic that will disagree.
 */
function withPrice(cfg: Config, priceUsd: number): Config {
  return { ...cfg, priceUsd, priceAtomic: toAtomic(priceUsd, USDC_DECIMALS) };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new BadInput("body too large");
    chunks.push(chunk as Buffer);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function applyOutcome(res: ServerResponse, outcome: PaidOutcome): void {
  const payload = JSON.stringify(outcome.body, null, 2);
  res.writeHead(outcome.status, {
    ...outcome.headers,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    vary: "Accept",
  });
  res.end(payload);
}
