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
    // "filter by company domain/name/LinkedIn URL" — the field name is not
    // published, so this is read off the description until a purchase proves it.
    byDomain: { build: (domain) => ({ company_domain: domain }), unverified: true },
  },
  "openwebninja-contacts": {
    id: "openwebninja-contacts",
    name: "OpenWebNinja website contacts scraper",
    url: "https://x402.openwebninja.com/website-contacts-scraper/scrape-contacts",
    method: "GET",
    listPriceUsd: 0.003,
    maxPriceUsd: 0.005,
    // No input schema, no description, no tags — nothing published at all. So
    // the first request carries every plausible spelling of the one parameter
    // it can possibly want. Unknown query parameters are ignored by almost
    // every API, which turns five guesses into one $0.003 purchase instead of
    // five. Once a real response names the field, this collapses to that field.
    byDomain: {
      build: (domain) => ({
        query: domain,
        website_url: `https://${domain}`,
        domain,
        url: `https://${domain}`,
        website: domain,
      }),
      unverified: true,
    },
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
