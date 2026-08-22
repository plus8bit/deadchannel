import { buy } from "../suppliers/buy.ts";
import { SUPPLIERS, SupplierError } from "../suppliers/types.ts";
import { buildProfile } from "../profile.ts";
import type { DomainProfile } from "../types.ts";

/**
 * The resale shelf: our own dossier plus contacts bought from a supplier,
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

const SUPPLIER_ID = "fullenrich-people";

export interface BundleResponse {
  domain: string;
  company: DomainProfile;
  people: {
    /** Exactly what the supplier returned, unedited. */
    data: unknown;
    source: string;
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

export async function runBundle(req: { domain: string }): Promise<BundleResponse> {
  const supplier = SUPPLIERS[SUPPLIER_ID];
  if (!supplier?.byDomain) {
    throw new SupplierError(SUPPLIER_ID, "no domain lookup configured", false);
  }

  // Our half costs nothing and never fails wholesale, so it runs alongside.
  const [company, purchase] = await Promise.all([
    buildProfile(req.domain),
    buy<unknown>(supplier, supplier.byDomain.build(req.domain)),
  ]);

  return {
    domain: req.domain,
    company,
    people: {
      data: purchase.data,
      source: supplier.name,
      costUsd: purchase.paidUsd,
      ...(purchase.unverifiedMapping ? { requestShapeUnverified: true } : {}),
    },
    collectedAt: new Date().toISOString(),
  };
}

export const PRICE_BUNDLE = 0.35;
