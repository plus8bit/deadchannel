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
  /** EIP-712 domain version of the USDC contract, needed by the exact scheme. */
  usdcVersion: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  "base-sepolia": {
    caip2: "eip155:84532",
    label: "Base Sepolia",
    testnet: true,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    usdcVersion: "2",
  },
  base: {
    caip2: "eip155:8453",
    label: "Base",
    testnet: false,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
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
}

const USDC_DECIMALS = 6;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const networkKey = env["X402_NETWORK"] ?? "base-sepolia";
  const network = NETWORKS[networkKey];
  if (!network) {
    problems.push(`X402_NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}, got "${networkKey}"`);
  }

  const payTo = env["X402_PAY_TO"] ?? "";
  if (!EVM_ADDRESS.test(payTo)) {
    problems.push(`X402_PAY_TO must be a 0x-prefixed 40-hex-digit address, got "${payTo || "(unset)"}"`);
  }
  if (/^0x0{40}$/i.test(payTo)) {
    problems.push("X402_PAY_TO is the zero address — payments would be destroyed");
  }

  const priceUsd = Number(env["X402_PRICE_USD"] ?? "0.001");
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    problems.push(`X402_PRICE_USD must be a positive number, got "${env["X402_PRICE_USD"]}"`);
  }

  const port = Number(env["PORT"] ?? "8402");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be a valid port number, got "${env["PORT"]}"`);
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  const net = network as NetworkConfig;
  const publicUrl = (env["PUBLIC_URL"] ?? `http://localhost:${port}`).replace(/\/+$/, "");

  return {
    port,
    publicUrl,
    network: net,
    payTo,
    priceUsd,
    priceAtomic: toAtomic(priceUsd, USDC_DECIMALS),
    facilitatorUrl: (env["X402_FACILITATOR_URL"] ?? defaultFacilitator(net)).replace(/\/+$/, ""),
    facilitatorToken: env["X402_FACILITATOR_TOKEN"] ?? null,
    maxTimeoutSeconds: Number(env["X402_MAX_TIMEOUT_SECONDS"] ?? "120"),
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
