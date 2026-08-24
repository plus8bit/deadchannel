/**
 * Accepting payment on Robinhood Chain, where the dollar is not USDC.
 *
 * The chain is an Arbitrum Orbit L2 and behaves like any other EVM rail from a
 * seller's side, with one difference that matters: its canonical stablecoin is
 * Paxos USDG, the Global Dollar, and the EIP-712 domain a buyer signs against
 * says "Global Dollar" rather than "USD Coin". Getting that string wrong
 * produces a signature the facilitator rejects, silently, on every payment.
 *
 * USDG implements neither EIP-3009 nor EIP-2612, so the exact scheme runs
 * through Permit2 on this chain. That is entirely the buyer's client's problem;
 * a seller declares terms and routes verification, exactly as elsewhere.
 */

/** Robinhood Chain mainnet, live since July 2026. */
export const ROBINHOOD_MAINNET = "eip155:4663";

/** Paxos USDG. Six decimals, so USD pricing maps the same way USDC does. */
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const USDG_NAME = "Global Dollar";
export const USDG_VERSION = "1";

/** Solvador settles this chain; Coinbase and GoPlausible do not. */
export const DEFAULT_ROBINHOOD_FACILITATOR = "https://api.solvador.com";

/** The `accepts` entry that puts this endpoint on Robinhood Chain. */
export function robinhoodOption(payTo: string, priceAtomic: string, maxTimeoutSeconds: number) {
  return {
    scheme: "exact",
    network: ROBINHOOD_MAINNET,
    amount: priceAtomic,
    asset: USDG,
    payTo,
    maxTimeoutSeconds,
    extra: { name: USDG_NAME, version: USDG_VERSION },
  };
}
