/**
 * Buying from other x402 sellers, so we can resell what we cannot produce.
 *
 * Everything Hosaka currently sells is assembled from free public sources.
 * Contact data — names, work emails, phone numbers — cannot be. It has to be
 * bought, and inside x402 it can be bought per call with no contract and no
 * subscription, which is what makes reselling it viable at all.
 */

export interface Supplier {
  /** Short id used in ledgers and receipts. */
  id: string;
  name: string;
  url: string;
  method: "POST" | "GET";
  /** What we expect to pay, in USD. The real charge comes from the 402. */
  listPriceUsd: number;
  /** Refuse to pay more than this, however the endpoint prices itself today. */
  maxPriceUsd: number;
}

export interface Purchase<T> {
  supplier: string;
  /** What the endpoint actually charged, read from the settlement. */
  paidUsd: number;
  transaction: string | null;
  data: T;
}

export class SupplierError extends Error {
  readonly supplier: string;
  /** True when the supplier refused or failed, rather than us refusing to pay. */
  readonly upstream: boolean;

  constructor(supplier: string, message: string, upstream = true) {
    super(`${supplier}: ${message}`);
    this.name = "SupplierError";
    this.supplier = supplier;
    this.upstream = upstream;
  }
}

/**
 * Suppliers we are prepared to buy from, with a ceiling on each.
 *
 * The ceiling is the important field. An endpoint can reprice itself between
 * one call and the next, and a reseller that pays whatever it is quoted will
 * eventually pay more than it charged.
 */
export const SUPPLIERS: Record<string, Supplier> = {
  // Verified live with our own risk checker before being written down here:
  // reachable, priced as advertised, settling on Base mainnet.
  "pdl-person": {
    id: "pdl-person",
    name: "PDL Person Enrich",
    url: "https://stableenrich.dev/api/pdl/people-enrich",
    method: "POST",
    listPriceUsd: 0.28,
    maxPriceUsd: 0.35,
  },
  "fullenrich-people": {
    id: "fullenrich-people",
    name: "FullEnrich People Search",
    url: "https://stableenrich.dev/api/fullenrich/people-search",
    method: "POST",
    listPriceUsd: 0.15,
    maxPriceUsd: 0.2,
  },
  "linkedpanda-profile": {
    id: "linkedpanda-profile",
    name: "LinkedPanda profile enrichment",
    url: "https://api.linkedpanda.com/agent/v1/profiles/enrich",
    method: "GET",
    listPriceUsd: 0.05,
    maxPriceUsd: 0.08,
  },
};
