/**
 * Network identifier normalization.
 *
 * v1 endpoints send friendly names ("base-sepolia"); v2 endpoints send CAIP-2
 * ("eip155:84532", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"). Both are live in
 * the wild simultaneously, so everything downstream works on canonical names.
 */

export interface NetworkInfo {
  /** Canonical short name, e.g. "base-sepolia". */
  name: string;
  testnet: boolean;
  /** True when we recognized the identifier at all. */
  known: boolean;
}

const CAIP2: Record<string, { name: string; testnet: boolean }> = {
  "eip155:1": { name: "ethereum", testnet: false },
  "eip155:10": { name: "optimism", testnet: false },
  "eip155:56": { name: "bsc", testnet: false },
  "eip155:137": { name: "polygon", testnet: false },
  "eip155:8453": { name: "base", testnet: false },
  "eip155:84532": { name: "base-sepolia", testnet: true },
  "eip155:42161": { name: "arbitrum", testnet: false },
  "eip155:421614": { name: "arbitrum-sepolia", testnet: true },
  "eip155:43114": { name: "avalanche", testnet: false },
  "eip155:43113": { name: "avalanche-fuji", testnet: true },
  "eip155:1329": { name: "sei", testnet: false },
  "eip155:1328": { name: "sei-testnet", testnet: true },
  "eip155:4689": { name: "iotex", testnet: false },
  "eip155:196": { name: "x-layer", testnet: false },
  "eip155:143": { name: "monad", testnet: false },
  "eip155:5000": { name: "mantle", testnet: false },
  "eip155:59144": { name: "linea", testnet: false },
  "eip155:100": { name: "gnosis", testnet: false },
  "eip155:2020": { name: "ronin", testnet: false },
  // CAIP-2 identifies a Solana cluster by the first 32 chars of its genesis hash.
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { name: "solana", testnet: false },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { name: "solana-devnet", testnet: true },
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": { name: "solana-testnet", testnet: true },
  // Algorand identifies a network by the base64 genesis hash. CAIP-2 caps a
  // reference at 32 characters, so the spec-shaped id is the hash truncated —
  // but the facilitator actually serving Algorand sends the full 44-character
  // hash, padding included. Both forms appear in the wild and both must
  // resolve; matching only the spec-shaped one left every Algorand endpoint
  // reading as an unknown network, which is 1126 of them.
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k": { name: "algorand", testnet: false },
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=": { name: "algorand", testnet: false },
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe": { name: "algorand-testnet", testnet: true },
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=": { name: "algorand-testnet", testnet: true },
};

/** Some facilitators lowercase the reference part, so match case-insensitively too. */
const CAIP2_LOWER: Record<string, { name: string; testnet: boolean }> = Object.fromEntries(
  Object.entries(CAIP2).map(([k, v]) => [k.toLowerCase(), v]),
);

/** Friendly names that v1 endpoints use directly. */
const FRIENDLY = new Set([
  "ethereum", "optimism", "bsc", "polygon", "base", "base-sepolia",
  "arbitrum", "arbitrum-sepolia", "avalanche", "avalanche-fuji",
  "sei", "sei-testnet", "iotex", "solana", "solana-devnet", "solana-testnet",
  "algorand", "algorand-testnet",
]);

const TESTNET_PATTERN = /sepolia|devnet|testnet|fuji|goerli|holesky/i;

export function normalizeNetwork(raw: string | null | undefined): NetworkInfo {
  if (!raw) return { name: "unknown", testnet: false, known: false };
  const id = raw.trim();

  const caip = CAIP2[id] ?? CAIP2_LOWER[id.toLowerCase()];
  if (caip) return { name: caip.name, testnet: caip.testnet, known: true };

  const lower = id.toLowerCase();
  if (FRIENDLY.has(lower)) {
    return { name: lower, testnet: TESTNET_PATTERN.test(lower), known: true };
  }

  // Unrecognized but well-formed CAIP-2 — we can still tell the chain family.
  if (/^[a-z0-9-]{3,8}:[a-zA-Z0-9]{1,32}$/.test(id)) {
    return { name: id, testnet: TESTNET_PATTERN.test(id), known: false };
  }

  return { name: lower, testnet: TESTNET_PATTERN.test(lower), known: false };
}

/** Which address format a canonical network expects. */
export function addressFamily(name: string): "evm" | "solana" | "algorand" | "unknown" {
  if (name.startsWith("solana")) return "solana";
  if (name.startsWith("algorand")) return "algorand";
  if (name.startsWith("eip155:")) return "evm";
  if (FRIENDLY.has(name) || CAIP2[name]) return "evm";
  return "unknown";
}
