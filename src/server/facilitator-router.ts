import { FacilitatorClient } from "./facilitator.ts";
import { facilitatorAuth } from "./facilitator-auth.ts";
import type { Config } from "./config.ts";

/**
 * Picks the facilitator that can actually settle a given network.
 *
 * Facilitators are not interchangeable. Coinbase's settles the EVM chains and
 * indexes resources into the large discovery catalog; GoPlausible's settles
 * Algorand. A shop selling on both has to route by network, or half its
 * advertised offers are unpayable — and the failure surfaces at settlement,
 * after the buyer has already signed.
 */
export type FacilitatorFor = (network: string) => FacilitatorClient;

export function facilitatorsFor(cfg: Config, env: NodeJS.ProcessEnv = process.env): FacilitatorFor {
  const primary = new FacilitatorClient(cfg.facilitatorUrl, facilitatorAuth(cfg, env));
  // Built lazily: a shop that never advertises Algorand never constructs it.
  let algorand: FacilitatorClient | null = null;

  return (network: string) => {
    if (!network.startsWith("algorand:")) return primary;
    if (cfg.algorandFacilitatorUrl === cfg.facilitatorUrl) return primary;
    algorand ??= new FacilitatorClient(cfg.algorandFacilitatorUrl, null);
    return algorand;
  };
}

/** Adapts a single client, so existing callers and tests keep working. */
export function only(client: FacilitatorClient): FacilitatorFor {
  return () => client;
}
