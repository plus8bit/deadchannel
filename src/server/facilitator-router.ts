import { FacilitatorClient } from "./facilitator.ts";
import type { AuthProvider } from "./facilitator.ts";
import { ROBINHOOD_MAINNET } from "./robinhood.ts";
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
  // Built lazily: a shop that never advertises a chain never constructs its
  // client, and never demands the credentials that client would need.
  let algorand: FacilitatorClient | null = null;
  let robinhood: FacilitatorClient | null = null;

  return (network: string) => {
    if (network.startsWith("algorand:")) {
      if (cfg.algorandFacilitatorUrl === cfg.facilitatorUrl) return primary;
      algorand ??= new FacilitatorClient(cfg.algorandFacilitatorUrl, null);
      return algorand;
    }
    if (network === ROBINHOOD_MAINNET) {
      if (cfg.robinhoodFacilitatorUrl === cfg.facilitatorUrl) return primary;
      robinhood ??= new FacilitatorClient(cfg.robinhoodFacilitatorUrl, solvadorAuth(env));
      return robinhood;
    }
    return primary;
  };
}

/**
 * Solvador reads X-API-Key. Sending its key as a bearer token authenticates
 * nothing and fails at settlement, after the buyer has signed.
 */
function solvadorAuth(env: NodeJS.ProcessEnv): AuthProvider {
  return () => {
    const key = env["SOLVADOR_API_KEY"];
    if (!key) {
      throw new Error(
        "Robinhood Chain is advertised but SOLVADOR_API_KEY is unset. " +
          "Create a key at solvador.com, or unset X402_ROBINHOOD_PAY_TO to stop offering the chain.",
      );
    }
    return { "x-api-key": key };
  };
}

/** Adapts a single client, so existing callers and tests keep working. */
export function only(client: FacilitatorClient): FacilitatorFor {
  return () => client;
}
