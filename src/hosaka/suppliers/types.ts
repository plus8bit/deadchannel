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
  /**
   * Builds the request body from a company domain.
   *
   * Marked `unverified` where the supplier publishes no input schema — which is
   * most of them, including both top earners in this category. The field name
   * is then taken from the supplier's own prose, and the first real purchase
   * confirms or corrects it. Nothing here is guessed silently: an unverified
   * mapping is stated in the receipt the buyer gets back.
   */
  byDomain?: { build: (domain: string) => Record<string, unknown>; unverified?: boolean };
}

export interface Purchase<T> {
  supplier: string;
  /** True when the request shape was inferred rather than documented. */
  unverifiedMapping?: boolean;
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
    // The name came from the supplier itself. A request with the wrong field
    // was rejected with "Provide at least one search filter (e.g.
    // current_company_domains, ...)" — a 400 before settlement, so the answer
    // cost nothing. Plural because it filters a set; still flagged unverified
    // until a call actually returns people, since the shape is inferred from
    // the name rather than a schema.
    byDomain: { build: (domain) => ({ current_company_domains: [domain] }), unverified: true },
  },
  "openwebninja-contacts": {
    id: "openwebninja-contacts",
    name: "OpenWebNinja website contacts scraper",
    url: "https://x402.openwebninja.com/website-contacts-scraper/scrape-contacts",
    method: "GET",
    listPriceUsd: 0.003,
    maxPriceUsd: 0.005,
    // Nothing published at all — no input schema, no description, no tags. The
    // field name was established by paying once with a different value in each
    // candidate parameter and reading which one came back: see
    // scripts/learn-parameter.mjs. It is `query`; the rest were ignored.
    byDomain: { build: (domain) => ({ query: domain }) },
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
