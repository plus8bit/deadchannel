/**
 * Extra EVM chains this shop will take payment on.
 *
 * Every field here was read off the chain, not remembered. The EIP-712 domain
 * is the reason: a buyer signs against the token's own `name()` and
 * `version()`, and the two differ between chains that otherwise look
 * identical — USDC calls itself "USD Coin" on Polygon and Arbitrum but plain
 * "USDC" on Monad, and Robinhood Chain does not use USDC at all. Guess wrong
 * and every payment on that rail fails at verification, with nothing in the
 * response naming the cause.
 *
 * scripts/verify-rails.mjs re-reads all of it from the chains on demand.
 */

export interface EvmRail {
  caip2: string;
  label: string;
  /** The stablecoin contract. Not always USDC. */
  asset: string;
  /** EIP-712 domain of that contract, as the chain reports it. */
  name: string;
  version: string;
  /**
   * Which facilitator settles it. "primary" is whatever settles Base, so those
   * rails cost no extra credential; "solvador" needs SOLVADOR_API_KEY.
   */
  settledBy: "primary" | "solvador";
  /** A public node, used only to re-verify the domain above. */
  rpc: string;
  /**
   * Where the version string came from. USDG implements neither EIP-2612 nor
   * EIP-3009, so it has no `version()` to read: its domain version was taken
   * from a live 402 served by an established seller on that chain. Recorded
   * rather than assumed, so the verifier knows not to expect the chain to
   * confirm it.
   */
  versionSource: "chain" | "observed";
}

export const EVM_RAILS: Record<string, EvmRail> = {
  polygon: {
    caip2: "eip155:137",
    label: "Polygon",
    asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    name: "USD Coin",
    version: "2",
    settledBy: "primary",
    versionSource: "chain",
    rpc: "https://polygon-bor-rpc.publicnode.com",
  },
  arbitrum: {
    caip2: "eip155:42161",
    label: "Arbitrum",
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    name: "USD Coin",
    version: "2",
    settledBy: "primary",
    versionSource: "chain",
    rpc: "https://arb1.arbitrum.io/rpc",
  },
  monad: {
    caip2: "eip155:143",
    label: "Monad",
    asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    // Not "USD Coin". This is the whole reason the table exists.
    name: "USDC",
    version: "2",
    settledBy: "solvador",
    versionSource: "chain",
    rpc: "https://rpc.monad.xyz",
  },
  robinhood: {
    caip2: "eip155:4663",
    label: "Robinhood Chain",
    // Paxos USDG. The chain has no Circle USDC.
    asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    name: "Global Dollar",
    version: "1",
    settledBy: "solvador",
    versionSource: "observed",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
  },
};

/** The `accepts` entry for one rail. */
export function railOption(rail: EvmRail, payTo: string, priceAtomic: string, maxTimeoutSeconds: number) {
  return {
    scheme: "exact",
    network: rail.caip2,
    amount: priceAtomic,
    asset: rail.asset,
    payTo,
    maxTimeoutSeconds,
    extra: { name: rail.name, version: rail.version },
  };
}

/** Reads a comma-separated rail list, ignoring blanks and unknown names. */
export function parseRails(value: string | undefined): EvmRail[] {
  if (!value) return [];
  return value
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0)
    .map((n) => EVM_RAILS[n])
    .filter((r): r is EvmRail => r !== undefined);
}
