import { resolveAsset, toDecimal } from "./assets.ts";
import { normalizeNetwork } from "./networks.ts";
import type { BazaarMetadata, PaymentOption, PaymentRequirements } from "./types.ts";

/**
 * Parse a 402 body into payment requirements.
 *
 * Deliberately tolerant. The v1 and v2 specs disagree about where `x402Version`
 * lives, some facilitators omit it entirely, and several live servers nest the
 * whole payload one level deeper than documented. We read what is there and put
 * every deviation in `warnings` — those warnings are the product.
 */
export function parsePaymentRequirements(body: unknown): PaymentRequirements | null {
  const warnings: string[] = [];
  const root = asRecord(body);
  if (!root) return null;

  // Some servers wrap the payload: { data: { accepts: [...] } } or { x402: {...} }.
  let scope = root;
  if (!Array.isArray(root["accepts"])) {
    for (const key of ["data", "x402", "payment", "paymentRequirements"]) {
      const nested = asRecord(root[key]);
      if (nested && Array.isArray(nested["accepts"])) {
        scope = nested;
        warnings.push(`accepts[] was nested under "${key}" rather than at the top level`);
        break;
      }
    }
  }

  const rawAccepts = scope["accepts"];
  if (!Array.isArray(rawAccepts)) return null;

  const version = readInt(scope["x402Version"] ?? root["x402Version"]);
  if (version === null) {
    warnings.push("no x402Version field — all reference implementations send one");
  }

  // v2 hoists shared resource metadata to the root instead of repeating it per option.
  const rootResource = asRecord(scope["resource"]);
  const bazaarExt = asRecord(scope["extensions"]);

  const accepts: PaymentOption[] = [];
  for (const [i, entry] of rawAccepts.entries()) {
    const option = parseOption(entry, i, warnings, rootResource, bazaarExt);
    if (option) accepts.push(option);
  }

  return { x402Version: version, accepts, bazaar: parseBazaar(scope, rawAccepts), warnings };
}

function parseOption(
  entry: unknown,
  index: number,
  warnings: string[],
  rootResource: Record<string, unknown> | null,
  bazaarExt: Record<string, unknown> | null,
): PaymentOption | null {
  const o = asRecord(entry);
  if (!o) {
    warnings.push(`accepts[${index}] is not an object`);
    return null;
  }

  const amount =
    readString(o["maxAmountRequired"]) ?? readString(o["amount"]) ?? readString(o["maxAmount"]);
  if (amount === null) {
    warnings.push(`accepts[${index}] has no maxAmountRequired`);
  }

  const asset = readString(o["asset"]);
  const extra = asRecord(o["extra"]);
  const resolved = resolveAsset(asset, extra);
  const atomic = amount ?? "0";

  // Schemas may sit on the accepts entry, on ResourceInfo, or, most commonly in
  // v2, inside the bazaar extension's input/output descriptors.
  const bazaarInfo = asRecord(asRecord(bazaarExt?.["bazaar"])?.["info"]);
  const outputSchema =
    o["outputSchema"] ?? rootResource?.["outputSchema"] ?? bazaarInfo?.["output"];
  const inputSchema =
    o["inputSchema"] ??
    rootResource?.["inputSchema"] ??
    bazaarInfo?.["input"] ??
    asRecord(outputSchema)?.["input"];

  const net = normalizeNetwork(readString(o["network"]));

  return {
    scheme: readString(o["scheme"]) ?? "unknown",
    network: net.name,
    networkRaw: readString(o["network"]) ?? "unknown",
    networkKnown: net.known,
    networkTestnet: net.testnet,
    maxAmountRequired: atomic,
    amountDecimal: toDecimal(atomic, resolved.decimals),
    asset,
    assetSymbol: resolved.symbol,
    assetDecimals: resolved.decimals,
    payTo: readString(o["payTo"]),
    resource: readString(o["resource"]) ?? readString(rootResource?.["url"]),
    description: readString(o["description"]) ?? readString(rootResource?.["description"]),
    mimeType: readString(o["mimeType"]) ?? readString(rootResource?.["mimeType"]),
    maxTimeoutSeconds: readInt(o["maxTimeoutSeconds"]),
    hasOutputSchema: isMeaningful(outputSchema),
    hasInputSchema: isMeaningful(inputSchema),
  };
}

/**
 * Bazaar metadata can sit on the response root or on individual accepts entries,
 * depending on which facilitator built the response. Check both.
 */
function parseBazaar(scope: Record<string, unknown>, accepts: unknown[]): BazaarMetadata {
  const candidates: Record<string, unknown>[] = [];
  // v2 carries serviceName/tags/iconUrl on the ResourceInfo object.
  const resource = asRecord(scope["resource"]);
  if (resource) candidates.push(resource);
  const rootExt = asRecord(scope["extensions"]) ?? asRecord(scope["bazaar"]);
  if (rootExt) {
    candidates.push(rootExt);
    const bazaar = asRecord(rootExt["bazaar"]);
    if (bazaar) candidates.push(bazaar);
  }
  candidates.push(scope);
  for (const entry of accepts) {
    const o = asRecord(entry);
    if (o) {
      const ext = asRecord(o["extensions"]) ?? asRecord(o["bazaar"]);
      if (ext) candidates.push(ext);
      candidates.push(o);
    }
  }

  let serviceName: string | null = null;
  let iconUrl: string | null = null;
  const tags: string[] = [];

  for (const c of candidates) {
    serviceName ??= readString(c["serviceName"]) ?? readString(c["name"]);
    iconUrl ??= readString(c["iconUrl"]);
    const rawTags = c["tags"];
    if (Array.isArray(rawTags)) {
      for (const t of rawTags) {
        const s = readString(t);
        if (s && !tags.includes(s)) tags.push(s);
      }
    }
  }

  return { serviceName, tags, iconUrl };
}

/** A schema field that exists but is `{}` or `null` tells an agent nothing. */
function isMeaningful(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v !== "object") return false;
  return Object.keys(v as Record<string, unknown>).length > 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function readString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
}

function readInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}
