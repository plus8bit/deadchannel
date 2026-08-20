import { parsePaymentRequirements } from "../probe/parse.ts";
import type { PaymentOption } from "../probe/types.ts";

/**
 * Pulls the x402 catalog from public Bazaar discovery endpoints.
 *
 * Two facilitators publish one openly today and they disagree about field
 * names, so both are normalized to a single shape here. Neither requires a key.
 */

export interface CatalogEntry {
  url: string;
  source: "cdp" | "goplausible";
  description: string | null;
  accepts: PaymentOption[];
  /** Real demand, when the facilitator reports it. */
  callsL30d: number | null;
  uniquePayersL30d: number | null;
  lastCalledAt: string | null;
  hasInputSchema: boolean;
  hasOutputSchema: boolean;
  serviceName: string | null;
  tags: string[];
  /** HTTP verb the resource expects, when the catalog publishes it. */
  method: string | null;
}

const CDP = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const GOPLAUSIBLE = "https://facilitator.goplausible.xyz/discovery/resources";
const PAGE = 500;

export async function fetchCatalog(limit = Infinity): Promise<CatalogEntry[]> {
  const [cdp, gp] = await Promise.all([fetchCdp(limit), fetchGoPlausible()]);
  const merged = new Map<string, CatalogEntry>();
  for (const entry of [...cdp, ...gp]) {
    // Same resource can appear in both catalogs; first writer wins.
    if (!merged.has(entry.url)) merged.set(entry.url, entry);
  }
  return [...merged.values()];
}

async function fetchCdp(limit: number): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  let offset = 0;
  let total = Infinity;

  while (out.length < limit && offset < total) {
    const res = await fetch(`${CDP}?limit=${PAGE}&offset=${offset}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CDP discovery returned ${res.status}`);
    const body = (await res.json()) as {
      items?: unknown[];
      pagination?: { total?: number };
    };
    const items = body.items ?? [];
    if (items.length === 0) break;

    total = body.pagination?.total ?? items.length;
    for (const raw of items) out.push(normalizeCdp(raw as Record<string, unknown>));
    offset += items.length;
  }

  return out.slice(0, limit === Infinity ? undefined : limit);
}

async function fetchGoPlausible(): Promise<CatalogEntry[]> {
  try {
    const res = await fetch(GOPLAUSIBLE, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: unknown[] };
    return (body.items ?? []).map((raw) => normalizeGoPlausible(raw as Record<string, unknown>));
  } catch {
    // A single facilitator being down must not sink the whole scan.
    return [];
  }
}

function normalizeCdp(raw: Record<string, unknown>): CatalogEntry {
  const quality = (raw["quality"] ?? {}) as Record<string, unknown>;
  const bazaarInfo = readBazaarInfo(raw);
  return {
    url: String(raw["resource"] ?? ""),
    source: "cdp",
    description: str(raw["description"]),
    accepts: parseAccepts(raw),
    callsL30d: num(quality["l30DaysTotalCalls"]),
    uniquePayersL30d: num(quality["l30DaysUniquePayers"]),
    lastCalledAt: str(quality["lastCalledAt"]),
    hasInputSchema: bazaarInfo.input,
    hasOutputSchema: bazaarInfo.output,
    serviceName: bazaarInfo.serviceName,
    tags: bazaarInfo.tags,
    method: bazaarInfo.method,
  };
}

function normalizeGoPlausible(raw: Record<string, unknown>): CatalogEntry {
  const info = readBazaarInfo(raw, "discoveryInfo");
  return {
    url: String(raw["resourceUrl"] ?? ""),
    source: "goplausible",
    description: str(raw["description"]),
    accepts: parseAccepts(raw),
    // settleCount is settlements, not calls — the closest demand signal it has.
    callsL30d: num(raw["settleCount"]),
    uniquePayersL30d: null,
    lastCalledAt: str(raw["lastSeen"]),
    hasInputSchema: info.input,
    hasOutputSchema: info.output,
    serviceName: info.serviceName,
    tags: info.tags,
    method: str(raw["method"]) ?? info.method,
  };
}

/** Reuse the wire parser so catalog entries and live probes agree on pricing. */
function parseAccepts(raw: Record<string, unknown>): PaymentOption[] {
  const parsed = parsePaymentRequirements({
    x402Version: raw["x402Version"] ?? 2,
    accepts: raw["accepts"] ?? [],
  });
  return parsed?.accepts ?? [];
}

interface BazaarInfo {
  input: boolean;
  output: boolean;
  serviceName: string | null;
  tags: string[];
  method: string | null;
}

function readBazaarInfo(raw: Record<string, unknown>, key = "extensions"): BazaarInfo {
  const container = (raw[key] ?? {}) as Record<string, unknown>;
  const bazaar = ((container["bazaar"] ?? container) ?? {}) as Record<string, unknown>;
  const info = ((bazaar["info"] ?? bazaar) ?? {}) as Record<string, unknown>;
  const tags = Array.isArray(bazaar["tags"]) ? (bazaar["tags"] as unknown[]).map(String) : [];
  // CDP buries the verb inside the input descriptor rather than beside it.
  const input = (info["input"] ?? {}) as Record<string, unknown>;
  return {
    input: hasKeys(info["input"]),
    output: hasKeys(info["output"]) || hasKeys(info["outputSchema"]),
    serviceName: str(bazaar["serviceName"]) ?? str(info["serviceName"]),
    tags,
    method: str(input["method"]) ?? str(info["method"]),
  };
}

function hasKeys(v: unknown): boolean {
  return typeof v === "object" && v !== null && Object.keys(v as object).length > 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
