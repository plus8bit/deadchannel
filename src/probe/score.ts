import type { Signal, Verdict } from "./types.ts";

/**
 * Signals that mean the endpoint will actively cost an agent money or funds,
 * as opposed to merely being unavailable. These decide `trap` over `dead`.
 */
const HARM_SIGNALS = new Set(["price-sane", "price-stable", "pay-to-valid", "gate-closed"]);

export function scoreRisk(signals: Signal[]): number {
  const total = signals.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  return Math.min(100, Math.round(total));
}

export function decideVerdict(signals: Signal[], risk: number): Verdict {
  const by = (id: string) => signals.find((s) => s.id === id);
  const failed = (id: string) => by(id)?.status === "fail";

  if (failed("reachable")) return "dead";

  // Not an x402 resource at all — serves content openly, advertises no price.
  if (by("gate-closed")?.status === "skip" && failed("speaks-402")) return "unknown";

  if (failed("speaks-402") || failed("bot-gate")) return "dead";

  const harmful = signals.some((s) => s.status === "fail" && HARM_SIGNALS.has(s.id));
  if (harmful) return "trap";

  // Testnet-only is a real limitation but not a dead or malicious endpoint.
  if (failed("network-mainnet")) return "testnet";

  if (risk >= 25) return "degraded";
  return "live";
}

/** One-line summary an agent can log, or a human can read in a leaderboard row. */
export function summarize(verdict: Verdict, risk: number, signals: Signal[]): string {
  const worst = signals
    .filter((s) => s.status === "fail" || s.status === "warn")
    .sort((a, b) => b.weight - a.weight)[0];
  const head = `${verdict.toUpperCase()} (risk ${risk}/100)`;
  return worst ? `${head} — ${worst.detail}` : `${head} — no issues found.`;
}
