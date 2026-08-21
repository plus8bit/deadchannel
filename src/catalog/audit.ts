import { PRICE_CEILING_USD, PRICE_FLOOR_USD } from "../probe/checks.ts";
import type { CatalogEntry } from "./discovery.ts";

/**
 * Static audit of catalog metadata — no HTTP, no payment.
 *
 * Everything here is derived from what an endpoint already advertises about
 * itself, so it scales to the whole catalog in one pass. Live probing is the
 * expensive follow-up, reserved for entries this pass finds interesting.
 */

export type Flag =
  | "no-demand"
  | "stale"
  | "price-trap"
  | "dust-price"
  | "unpriceable"
  | "testnet-only"
  | "bad-payto"
  | "no-schema"
  | "no-tags";

export interface AuditedEntry extends CatalogEntry {
  flags: Flag[];
  priceUsd: number | null;
  networks: string[];
}

const STALE_AFTER_DAYS = 30;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ALGORAND_ADDRESS = /^[A-Z2-7]{58}$/;

export function auditEntry(entry: CatalogEntry, now = Date.now()): AuditedEntry {
  const flags: Flag[] = [];
  const priced = entry.accepts.filter((o) => o.priceUsd !== null);
  const priceUsd = priced.length > 0 ? Math.min(...priced.map((o) => o.priceUsd as number)) : null;

  if (entry.accepts.length > 0 && priced.length === 0) flags.push("unpriceable");
  if (priceUsd !== null && priceUsd > PRICE_CEILING_USD) flags.push("price-trap");
  if (priceUsd !== null && priceUsd > 0 && priceUsd < PRICE_FLOOR_USD) flags.push("dust-price");

  const mainnet = entry.accepts.filter((o) => !o.networkTestnet && o.network !== "unknown");
  if (entry.accepts.length > 0 && mainnet.length === 0) flags.push("testnet-only");

  const badPayTo = entry.accepts.some(
    (o) => o.payTo !== null && !looksLikeAddress(o.payTo, o.network),
  );
  if (badPayTo || entry.accepts.every((o) => o.payTo === null)) flags.push("bad-payto");

  // A catalog entry nobody has paid for in 30 days is shelfware.
  if (entry.callsL30d === null || entry.callsL30d === 0) flags.push("no-demand");

  if (entry.lastCalledAt !== null) {
    const age = now - Date.parse(entry.lastCalledAt);
    if (Number.isFinite(age) && age > STALE_AFTER_DAYS * 86_400_000) flags.push("stale");
  }

  if (!entry.hasInputSchema && !entry.hasOutputSchema) flags.push("no-schema");
  if (entry.tags.length === 0) flags.push("no-tags");

  return {
    ...entry,
    flags,
    priceUsd,
    networks: [...new Set(entry.accepts.map((o) => o.network))],
  };
}

function looksLikeAddress(addr: string, network: string): boolean {
  if (network.startsWith("solana")) return SOLANA_ADDRESS.test(addr);
  if (network.startsWith("algorand")) return ALGORAND_ADDRESS.test(addr);
  return EVM_ADDRESS.test(addr) || SOLANA_ADDRESS.test(addr) || ALGORAND_ADDRESS.test(addr);
}

export interface CatalogReport {
  total: number;
  flagCounts: Record<Flag, number>;
  /** Entries with at least one real paid call in the last 30 days. */
  withDemand: number;
  callsL30d: number;
  /** Share of catalog held by the largest payout addresses. */
  operators: OperatorShare[];
  priceBuckets: Record<string, number>;
  networks: Record<string, number>;
}

export interface OperatorShare {
  payTo: string;
  resources: number;
  callsL30d: number;
  share: number;
}

export function buildReport(entries: AuditedEntry[]): CatalogReport {
  const flagCounts = {} as Record<Flag, number>;
  const operators = new Map<string, { resources: number; calls: number }>();
  const priceBuckets: Record<string, number> = {
    "free / $0": 0,
    "under $0.001": 0,
    "$0.001 – $0.01": 0,
    "$0.01 – $0.10": 0,
    "$0.10 – $1": 0,
    "$1 – $5": 0,
    "over $5": 0,
    unpriceable: 0,
  };
  const networks: Record<string, number> = {};
  let withDemand = 0;
  let callsL30d = 0;

  for (const e of entries) {
    for (const f of e.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
    if ((e.callsL30d ?? 0) > 0) withDemand++;
    callsL30d += e.callsL30d ?? 0;

    bump(priceBuckets, bucketFor(e.priceUsd));
    for (const n of e.networks) networks[n] = (networks[n] ?? 0) + 1;

    const payTo = e.accepts.find((o) => o.payTo !== null)?.payTo;
    if (payTo) {
      const seen = operators.get(payTo) ?? { resources: 0, calls: 0 };
      seen.resources++;
      seen.calls += e.callsL30d ?? 0;
      operators.set(payTo, seen);
    }
  }

  const top = [...operators.entries()]
    .map(([payTo, v]) => ({
      payTo,
      resources: v.resources,
      callsL30d: v.calls,
      share: v.resources / entries.length,
    }))
    .sort((a, b) => b.resources - a.resources)
    .slice(0, 10);

  return { total: entries.length, flagCounts, withDemand, callsL30d, operators: top, priceBuckets, networks };
}

function bucketFor(price: number | null): string {
  if (price === null) return "unpriceable";
  if (price === 0) return "free / $0";
  if (price < 0.001) return "under $0.001";
  if (price < 0.01) return "$0.001 – $0.01";
  if (price < 0.1) return "$0.01 – $0.10";
  if (price < 1) return "$0.10 – $1";
  if (price <= 5) return "$1 – $5";
  return "over $5";
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}
