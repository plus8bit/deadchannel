/**
 * Asset registry. Used to turn an advertised atomic amount into a real price.
 *
 * Without this, `maxAmountRequired: "1000"` is meaningless — it is $0.001 for
 * 6-decimal USDC and $0.000000000001 for an 18-decimal token. Endpoints that
 * advertise an unknown asset are scored as unpriceable rather than cheap.
 */

interface AssetInfo {
  symbol: string;
  decimals: number;
  /** USD value of one whole unit. Stablecoins only for now — we do not price volatiles. */
  usd: number;
}

/** Lowercased address -> asset. Addresses are chain-scoped but collisions are not a concern here. */
const REGISTRY = new Map<string, AssetInfo>([
  // USDC, 6 decimals everywhere
  ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", { symbol: "USDC", decimals: 6, usd: 1 }], // Base
  ["0x036cbd53842c5426634e7929541ec2318f3dcf7e", { symbol: "USDC", decimals: 6, usd: 1 }], // Base Sepolia
  ["0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", { symbol: "USDC", decimals: 6, usd: 1 }], // Polygon
  ["0xaf88d065e77c8cc2239327c5edb3a432268e5831", { symbol: "USDC", decimals: 6, usd: 1 }], // Arbitrum
  ["0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", { symbol: "USDC", decimals: 6, usd: 1 }], // Avalanche
  ["epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v", { symbol: "USDC", decimals: 6, usd: 1 }], // Solana
  ["4zmmc9srt5ri5x14gagxhahii3gnpaeerypjgzjdncdu", { symbol: "USDC", decimals: 6, usd: 1 }], // Solana devnet
  // Algorand names an asset by its integer ASA id, not an address. 31566704 is
  // USDC on MainNet; 10458941 is USDC on TestNet.
  ["31566704", { symbol: "USDC", decimals: 6, usd: 1 }],
  ["10458941", { symbol: "USDC", decimals: 6, usd: 1 }],
]);

export interface ResolvedAsset {
  symbol: string | null;
  decimals: number | null;
  usdPerUnit: number | null;
}

/**
 * Resolve an asset from the address plus whatever the endpoint put in `extra`.
 *
 * Order matters: an explicit `extra.decimals` from the server beats our table,
 * because a server that bothers to declare decimals is more likely to be right
 * about its own token than we are.
 */
export function resolveAsset(
  address: string | null | undefined,
  extra: Record<string, unknown> | null | undefined,
): ResolvedAsset {
  const declaredDecimals = readNumber(extra?.["decimals"]);
  const declaredName = readString(extra?.["name"]) ?? readString(extra?.["symbol"]);

  const known = address ? REGISTRY.get(address.toLowerCase()) : undefined;
  if (known) {
    return {
      symbol: known.symbol,
      decimals: declaredDecimals ?? known.decimals,
      usdPerUnit: known.usd,
    };
  }

  // Unknown address. Only a stablecoin-shaped name buys a USD valuation; every
  // other token decodes to an amount but stays unpriced, because we have no
  // business guessing what a memecoin is worth.
  const looksStable = declaredName
    ? /^(usdc|usd coin|usdbc|usdt|tether|pyusd|usdg|dai|eurc)$/i.test(declaredName.trim())
    : false;
  return {
    symbol: declaredName ?? null,
    decimals: declaredDecimals ?? (looksStable ? 6 : null),
    usdPerUnit: looksStable ? 1 : null,
  };
}

/** Convert an atomic string amount to a decimal number, or null if we cannot. */
export function toDecimal(atomic: string, decimals: number | null): number | null {
  if (decimals === null || !/^\d+$/.test(atomic)) return null;
  try {
    const value = BigInt(atomic);
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const frac = value % divisor;
    return Number(whole) + Number(frac) / Number(divisor);
  } catch {
    return null;
  }
}

function readNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
