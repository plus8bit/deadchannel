import { buy } from "../suppliers/buy.ts";
import { SUPPLIERS, SupplierError } from "../suppliers/types.ts";
import { buildProfile } from "../profile.ts";
import { summarise } from "../contacts.ts";
import { summarisePeople } from "../people.ts";
import type { ContactSummary } from "../contacts.ts";
import type { PeopleSummary } from "../people.ts";
import type { DomainProfile } from "../types.ts";

/**
 * The resale shelves: our own dossier plus contacts bought from a supplier,
 * delivered in one call.
 *
 * The point is not the markup on the purchased half — that would be thin and
 * pointless. It is that a buyer with a domain and a question gets both halves
 * at once instead of finding two sellers, comparing them and paying twice. We
 * add the free half, the routing and the payment handling.
 *
 * Ordering matters: the supplier is paid before our own settlement lands, so a
 * float is required in the operating wallet. If the supplier fails we throw,
 * which means we never settle, which means the buyer is not charged for a
 * half-delivered answer.
 */

/**
 * Two tiers, because two different things get called "contacts".
 *
 * Named people with roles cost fifty times what a scrape of a company's own
 * published addresses costs, and they are worth it for some questions and
 * pointless for others. Selling them as one product would mean either
 * overcharging for the cheap answer or quietly serving it when the expensive
 * one was paid for. So they are separate shelves at separate prices, and the
 * response says which one arrived.
 */
export const TIERS = {
  executives: {
    supplier: "fullenrich-people",
    kind: "decision-makers",
    /**
     * The seniority levels a B2B buyer is actually looking for.
     *
     * The supplier accepts nine, and the two omitted — Manager and Senior —
     * describe people who carry out a decision rather than make one. The list
     * came from the supplier's own validator: sending an invalid value made it
     * enumerate every option it accepts, for nothing.
     */
    seniority: ["Owner", "Founder", "C-level", "Partner", "VP", "Head", "Director"],
    /**
     * $0.30 against the same $0.15 cost as the unfiltered shelf.
     *
     * The purchase price does not change, so the premium is not for more data —
     * it is for less of it, chosen. A list of everyone at a company and a list
     * of the seven people who can sign are not the same product, and the second
     * is the one anyone selling B2B came for.
     */
    priceUsd: 0.21,
  },
  people: {
    supplier: "fullenrich-people",
    kind: "named-people",
    /**
     * $0.19 against a $0.16 ceiling on the supplier.
     *
     * The old price was set against a $0.28 competitor that no longer sets it.
     * Our own supplier is listed in the same catalog at $0.15 and ranks first
     * for the query this shelf answers, while we did not appear at all: selling
     * a marked-up copy above the original, on the shelf where the original
     * sits, is not a position an agent will ever choose.
     *
     * What survives that comparison is the pairing rather than the contacts —
     * the proven vendor stack and the people in a single call — so it is priced
     * to cost no more than buying the two halves apart, and wins on being one
     * call whose answer is already sorted.
     */
    priceUsd: 0.19,
  },
  contacts: {
    supplier: "openwebninja-contacts",
    kind: "published-contact-points",
    /**
     * $0.02 against a $0.003 supplier cost.
     *
     * Cheap because the underlying answer is cheap: it is what the company
     * publishes about itself, not who works there. Priced as the shelf a buyer
     * reaches for when the question is "how do I reach this company" and the
     * $0.25 answer would be waste.
     */
    priceUsd: 0.02,
  },
} as const satisfies Record<
  string,
  { supplier: string; kind: string; priceUsd: number; seniority?: readonly string[] }
>;

export type TierName = keyof typeof TIERS;

export interface BundleResponse {
  domain: string;
  company: DomainProfile;
  contacts: {
    /**
     * The company's own contact points, sorted out of everything else the
     * scraper reached. Null when the supplier returned a shape we do not
     * recognise, in which case `data` is still there to read.
     */
    summary: ContactSummary | PeopleSummary | null;
    /** Exactly what the supplier returned, unedited, so nothing is taken on trust. */
    data: unknown;
    source: string;
    /**
     * Which tier this is. The two are not interchangeable, and a buyer that
     * cannot tell them apart cannot tell whether the answer is the one they
     * needed.
     */
    kind: string;
    /** What this half cost us, so the buyer can see the resale is declared. */
    costUsd: number;
    /**
     * Set when the request shape was read off the supplier's prose rather than
     * a published schema. Stated rather than hidden: if the supplier wanted a
     * different field, this is the line that explains an empty result.
     */
    requestShapeUnverified?: boolean;
  };
  collectedAt: string;
}

export async function runBundle(req: { domain: string }, tier: TierName): Promise<BundleResponse> {
  const spec = TIERS[tier];
  const { supplier: id, kind } = spec;
  const supplier = SUPPLIERS[id];
  if (!supplier?.byDomain) throw new SupplierError(id, "no domain lookup configured", false);

  const seniority = "seniority" in spec ? spec.seniority : undefined;
  const body = {
    ...supplier.byDomain.build(req.domain),
    ...(seniority ? { current_position_seniority_level: [...seniority] } : {}),
  };

  // Our half costs nothing and never fails wholesale, so it runs alongside.
  const [company, purchase] = await Promise.all([buildProfile(req.domain), buy<unknown>(supplier, body)]);

  return {
    domain: req.domain,
    company,
    contacts: {
      // Each tier gets the reading of its own shape. A contact scrape and a
      // people-data response have nothing structurally in common.
      summary:
        tier === "people" || tier === "executives"
          ? summarisePeople(purchase.data)
          : summarise(req.domain, purchase.data),
      data: purchase.data,
      source: supplier.name,
      kind,
      costUsd: purchase.paidUsd,
      ...(purchase.unverifiedMapping ? { requestShapeUnverified: true } : {}),
    },
    collectedAt: new Date().toISOString(),
  };
}

/** Kept as a named export because the route table and the tests both read it. */
export const PRICE_BUNDLE = TIERS.people.priceUsd;
export const PRICE_CONTACTS = TIERS.contacts.priceUsd;
export const PRICE_EXECUTIVES = TIERS.executives.priceUsd;
