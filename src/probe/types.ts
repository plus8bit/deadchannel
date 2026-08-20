/**
 * Domain types for x402 endpoint probing.
 *
 * The ecosystem ships v1 and v2 payment requirements side by side, and several
 * live facilitators emit fields the spec does not document (see coinbase/x402#1176).
 * Everything here is therefore tolerant by design: we record what we found rather
 * than rejecting payloads that fail a strict schema.
 */

/** One entry from the `accepts` array of a 402 response. */
export interface PaymentOption {
  scheme: string;
  /** Canonical network name, normalized from either a friendly name or CAIP-2. */
  network: string;
  /** Exactly what the endpoint sent, before normalization. */
  networkRaw: string;
  networkKnown: boolean;
  networkTestnet: boolean;
  /** Raw atomic amount as advertised, kept as string to avoid precision loss. */
  maxAmountRequired: string;
  /** Decoded human amount, when we could determine the asset's decimals. */
  amountDecimal: number | null;
  asset: string | null;
  assetSymbol: string | null;
  assetDecimals: number | null;
  payTo: string | null;
  resource: string | null;
  description: string | null;
  mimeType: string | null;
  maxTimeoutSeconds: number | null;
  hasOutputSchema: boolean;
  hasInputSchema: boolean;
}

/** Bazaar discovery metadata, when the resource publishes it. */
export interface BazaarMetadata {
  serviceName: string | null;
  tags: string[];
  iconUrl: string | null;
}

export interface PaymentRequirements {
  x402Version: number | null;
  accepts: PaymentOption[];
  bazaar: BazaarMetadata;
  /** Parse problems that did not prevent us reading the payload. */
  warnings: string[];
}

export type SignalStatus = "pass" | "warn" | "fail" | "skip";

/** One observable fact about the endpoint. Signals never throw; they report. */
export interface Signal {
  id: string;
  status: SignalStatus;
  /** Human-readable, written for the operator who has to fix it. */
  detail: string;
  /** How much this signal moves the risk score. Positive numbers add risk. */
  weight: number;
}

export type Verdict =
  /** Safe to call: gated, priced sanely, settles on mainnet. */
  | "live"
  /** Callable, but with problems an agent should weigh. */
  | "degraded"
  /** Will actively cost the caller money or funds. */
  | "trap"
  /** Works, but only on a testnet — cannot accept real value. */
  | "testnet"
  /** Unreachable, bot-walled, or not serving payment requirements. */
  | "dead"
  /** Reachable, but not an x402 resource at all. */
  | "unknown";

export interface ProbeResult {
  url: string;
  verdict: Verdict;
  /** 0 = safe to call, 100 = do not call. */
  risk: number;
  signals: Signal[];
  requirements: PaymentRequirements | null;
  latency: LatencyStats | null;
  /** Cheapest advertised price across all accepted options, in USD. */
  priceUsd: number | null;
  probedAt: string;
  /** Number of HTTP round trips this probe made. */
  samples: number;
}

export interface LatencyStats {
  samples: number[];
  p50: number;
  p99: number;
  min: number;
  max: number;
}

export interface ProbeOptions {
  /** How many times to hit the endpoint. More samples = better latency + stability data. */
  samples?: number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Delay between samples in ms, to avoid tripping rate limits. */
  spacingMs?: number;
  /** User-Agent to send. Changing this is how we detect bot gating. */
  userAgent?: string;
}
