import type { Config } from "./config.ts";
import { createCdpBearer, readCdpCredentials } from "./cdp-auth.ts";
import type { AuthProvider } from "./facilitator.ts";
import { staticToken } from "./facilitator.ts";

/**
 * Chooses how to authenticate against the configured facilitator.
 *
 * Coinbase needs a fresh EdDSA JWT per request; the keyless facilitators need
 * nothing at all. Picking by URL rather than by flag means a deployment cannot
 * be pointed at CDP while silently sending no credentials.
 */
export function facilitatorAuth(cfg: Config, env: NodeJS.ProcessEnv = process.env): AuthProvider {
  if (isCdp(cfg.facilitatorUrl)) {
    const credentials = readCdpCredentials(env);
    if (!credentials) {
      throw new Error(
        "facilitator is CDP but CDP_API_KEY_ID / CDP_API_KEY_SECRET are unset. " +
          "Create a key at portal.cdp.coinbase.com, or point X402_FACILITATOR_URL at a keyless facilitator.",
      );
    }
    return (method, url) => `Bearer ${createCdpBearer(credentials, method, url)}`;
  }
  return staticToken(cfg.facilitatorToken);
}

export function isCdp(url: string): boolean {
  try {
    return new URL(url).host.endsWith("cdp.coinbase.com");
  } catch {
    return false;
  }
}
