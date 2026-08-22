import defaults from "../../deadchannel.config.json" with { type: "json" };
import { isAlgorandAddress } from "./algorand.ts";

/**
 * Server configuration, resolved and validated once at boot.
 *
 * A misconfigured seller is worse than an offline one: it advertises a price,
 * takes a payment and sends it somewhere wrong. Every field is therefore
 * checked here and the process refuses to start rather than run half-configured.
 */

export interface NetworkConfig {
  /** CAIP-2 identifier as it appears on the wire. */
  caip2: string;
  label: string;
  testnet: boolean;
  usdc: string;
  /**
   * EIP-712 domain of the USDC contract, read from `name()` and `version()`
   * on chain. The buyer signs a transfer authorization against this exact
   * domain, so a wrong string produces a signature the facilitator rejects.
   * The two networks genuinely differ: mainnet is "USD Coin", Sepolia "USDC".
   */
  usdcName: string;
  usdcVersion: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  "base-sepolia": {
    caip2: "eip155:84532",
    label: "Base Sepolia",
    testnet: true,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    usdcName: "USDC",
    usdcVersion: "2",
  },
  base: {
    caip2: "eip155:8453",
    label: "Base",
    testnet: false,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdcName: "USD Coin",
    usdcVersion: "2",
  },
};

export interface Config {
  port: number;
  /** Public origin this service is reachable at; used to build resource URLs. */
  publicUrl: string;
  network: NetworkConfig;
  /** Address that receives every payment. */
  payTo: string;
  priceUsd: number;
  /** Price in atomic USDC units, derived from priceUsd. */
  priceAtomic: string;
  facilitatorUrl: string;
  /** Optional bearer token, for facilitators that require auth (e.g. CDP). */
  facilitatorToken: string | null;
  maxTimeoutSeconds: number;
  /**
   * Optional second payout address, on Algorand.
   *
   * Set it and every 402 offers Algorand alongside Base, letting a buyer pay on
   * whichever chain it already holds USDC. Leave it unset and nothing changes.
   */
  algorandPayTo: string | null;
  /**
   * Who settles Algorand payments, which is rarely whoever settles Base ones.
   *
   * Coinbase's facilitator indexes into the large catalog but does not settle
   * on Algorand at all, so a shop that advertises both chains through one
   * facilitator is advertising an offer half its buyers cannot pay.
   */
  algorandFacilitatorUrl: string;
}

export const USDC_DECIMALS = 6;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/**
 * Committed defaults, so a deployment is correct without dashboard state.
 *
 * Imported statically rather than read from disk: a bundler will inline this,
 * whereas a runtime file read breaks the moment the code is bundled into a
 * serverless function whose working directory is not the repository root.
 */
export interface FileDefaults {
  /** Algorand payout address, when this deployment also sells on Algorand. */
  algorandPayTo?: string;
  algorandFacilitatorUrl?: string;
  payTo?: string;
  network?: string;
  priceUsd?: number;
  publicUrl?: string;
  facilitatorUrl?: string;
}

const FILE_DEFAULTS = defaults as FileDefaults;

/**
 * @param defaults Committed settings for *this* deployment. Passed explicitly
 * because a bundler inlines whichever config file the module imports, so two
 * shops built from one repo would otherwise both advertise the first one's URL
 * — and the advertised URL is what the catalog indexes.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaults: FileDefaults = FILE_DEFAULTS,
): Config {
  const problems: string[] = [];
  // Environment always wins, so a deployment can be retargeted without a commit.
  const file: FileDefaults = env["X402_IGNORE_CONFIG_FILE"] === "1" ? {} : defaults;

  const networkKey = env["X402_NETWORK"] ?? file.network ?? "base-sepolia";
  const network = NETWORKS[networkKey];
  if (!network) {
    problems.push(`X402_NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}, got "${networkKey}"`);
  }

  const payTo = env["X402_PAY_TO"] ?? file.payTo ?? "";
  if (!EVM_ADDRESS.test(payTo)) {
    problems.push(`X402_PAY_TO must be a 0x-prefixed 40-hex-digit address, got "${payTo || "(unset)"}"`);
  }
  if (/^0x0{40}$/i.test(payTo)) {
    problems.push("X402_PAY_TO is the zero address — payments would be destroyed");
  }

  const priceUsd = Number(env["X402_PRICE_USD"] ?? file.priceUsd ?? 0.001);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    problems.push(`X402_PRICE_USD must be a positive number, got "${env["X402_PRICE_USD"]}"`);
  }

  const port = Number(env["PORT"] ?? "8402");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be a valid port number, got "${env["PORT"]}"`);
  }

  // Refused rather than ignored when malformed: an unnoticed typo here means
  // payments settle to an address nobody can spend from.
  const algorandPayTo = env["X402_ALGORAND_PAY_TO"] ?? file.algorandPayTo ?? null;
  if (algorandPayTo !== null && !isAlgorandAddress(algorandPayTo)) {
    problems.push(
      `X402_ALGORAND_PAY_TO must be a 58-character Algorand address with a valid checksum, got "${algorandPayTo}"`,
    );
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  const net = network as NetworkConfig;
  const publicUrl = (
    env["PUBLIC_URL"] ??
    file.publicUrl ??
    // Vercel injects the deployment host but not the scheme.
    (env["VERCEL_PROJECT_PRODUCTION_URL"] ? `https://${env["VERCEL_PROJECT_PRODUCTION_URL"]}` : null) ??
    `http://localhost:${port}`
  ).replace(/\/+$/, "");

  return {
    port,
    publicUrl,
    network: net,
    payTo,
    priceUsd,
    priceAtomic: toAtomic(priceUsd, USDC_DECIMALS),
    facilitatorUrl: (env["X402_FACILITATOR_URL"] ?? file.facilitatorUrl ?? defaultFacilitator(net)).replace(/\/+$/, ""),
    facilitatorToken: env["X402_FACILITATOR_TOKEN"] ?? null,
    maxTimeoutSeconds: Number(env["X402_MAX_TIMEOUT_SECONDS"] ?? "120"),
    algorandPayTo,
    algorandFacilitatorUrl: (
      env["X402_ALGORAND_FACILITATOR_URL"] ??
      file.algorandFacilitatorUrl ??
      "https://facilitator.goplausible.xyz"
    ).replace(/\/+$/, ""),
  };
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

function defaultFacilitator(net: NetworkConfig): string {
  // Both are keyless and support the v2 exact scheme on their network.
  return net.testnet ? "https://x402.org/facilitator" : "https://facilitator.xpay.sh";
}

/**
 * Convert a decimal USD price to atomic token units without floating-point drift.
 * `0.001` at 6 decimals must be exactly "1000", never "999" or "1000.0000001".
 */
export function toAtomic(amount: number, decimals: number): string {
  const [whole = "0", frac = ""] = amount.toFixed(decimals).split(".");
  const padded = frac.padEnd(decimals, "0").slice(0, decimals);
  const atomic = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  return atomic;
}
