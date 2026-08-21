import { AGENT_UA, BROWSER_UA, latencySignal, runChecks } from "./checks.ts";
import { observe } from "./observe.ts";
import type { Observation } from "./observe.ts";
import { decideVerdict, scoreRisk } from "./score.ts";
import type { LatencyStats, ProbeOptions, ProbeResult } from "./types.ts";

const DEFAULTS = { samples: 3, timeoutMs: 10_000, spacingMs: 350, userAgent: AGENT_UA } as const;

/**
 * Probe an x402 resource and return a verdict.
 *
 * Never pays. Everything here is derived from unpaid 402 responses, which is
 * what makes it cheap enough to run across a whole catalog. Verifying that an
 * endpoint actually *delivers* requires a real settlement and is a separate,
 * paid tier.
 */
export async function probe(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const cfg = { ...DEFAULTS, ...options };
  const target = normalizeUrl(url);

  // Resolve the method before sampling. Probing a POST-only route with GET
  // yields 404/405, which is indistinguishable from a dead endpoint — this is
  // the single largest source of false "dead" verdicts across a catalog.
  const method = await resolveMethod(target, cfg);

  const agentSamples: Observation[] = [];
  for (let i = 0; i < cfg.samples; i++) {
    if (i > 0 && cfg.spacingMs > 0) await sleep(cfg.spacingMs);
    agentSamples.push(await observe(target, { timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent, method }));
  }

  // Only spend an extra round trip on bot-gate detection when the agent UA
  // looked blocked — otherwise the comparison tells us nothing.
  let browserSample: Observation | null = null;
  const looksBlocked = agentSamples.some(
    (s) => s.responded && s.status !== null && [403, 429, 503].includes(s.status),
  );
  if (looksBlocked) {
    browserSample = await observe(target, { timeoutMs: cfg.timeoutMs, userAgent: BROWSER_UA, method });
  }

  const signals = runChecks({ agentSamples, browserSample });

  const latency = computeLatency(agentSamples);
  if (latency) signals.push(latencySignal(latency.p99));

  const risk = scoreRisk(signals);
  const requirements = agentSamples.find((s) => s.requirements !== null)?.requirements ?? null;

  const prices = (requirements?.accepts ?? [])
    .map((o) => o.priceUsd)
    .filter((n): n is number => n !== null && n > 0);

  return {
    url: target,
    verdict: decideVerdict(signals, risk),
    risk,
    signals,
    requirements,
    latency,
    priceUsd: prices.length > 0 ? Math.min(...prices) : null,
    probedAt: new Date().toISOString(),
    samples: agentSamples.length + (browserSample ? 1 : 0),
  };
}

/**
 * Pick the method to probe with. An explicit one from the catalog is trusted;
 * otherwise try GET and fall back to POST when the route rejects the verb.
 */
async function resolveMethod(
  target: string,
  cfg: { timeoutMs: number; userAgent: string; method?: string },
): Promise<string> {
  if (cfg.method) return cfg.method.toUpperCase();

  const first = await observe(target, { timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent, method: "GET" });
  const verbRejected = first.status === 405 || first.status === 404 || first.status === 501;
  if (!verbRejected) return "GET";

  const retry = await observe(target, { timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent, method: "POST" });
  return retry.status === 402 || retry.requirements !== null ? "POST" : "GET";
}

function computeLatency(samples: Observation[]): LatencyStats | null {
  const ms = samples.filter((s) => s.responded).map((s) => Math.round(s.ms)).sort((a, b) => a - b);
  if (ms.length === 0) return null;
  return {
    samples: ms,
    p50: percentile(ms, 0.5),
    p99: percentile(ms, 0.99),
    min: ms[0] as number,
    max: ms[ms.length - 1] as number,
  };
}

/** Nearest-rank percentile over an already-sorted array. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(q * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme).toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
