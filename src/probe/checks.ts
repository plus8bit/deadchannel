import type { Observation } from "./observe.ts";
import { AGENT_UA, BROWSER_UA } from "./observe.ts";
import { addressFamily } from "./networks.ts";
import type { PaymentOption, Signal } from "./types.ts";

/**
 * Price sanity band. Below the floor the endpoint cannot cover its own gas and is
 * probably a farming stub; above the ceiling a single agent call can burn a budget.
 * Bounds follow the thresholds x402station publishes for its verified tier.
 */
export const PRICE_FLOOR_USD = 0.0001;
export const PRICE_CEILING_USD = 5;
/** An agent that waits longer than this has usually already failed its own deadline. */
export const P99_LATENCY_BUDGET_MS = 5000;

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ALGORAND_ADDRESS = /^[A-Z2-7]{58}$/;

const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
]);

/** Response bodies that mean "a bot wall answered", not "the service answered". */
const BOT_WALL = /just a moment|checking your browser|cf-browser-verification|captcha|attention required|enable javascript and cookies/i;

export interface CheckInput {
  /** Samples taken with the agent User-Agent. At least one. */
  agentSamples: Observation[];
  /** Optional single sample with a browser User-Agent, for bot-gate detection. */
  browserSample: Observation | null;
}

export function runChecks(input: CheckInput): Signal[] {
  const { agentSamples, browserSample } = input;
  const signals: Signal[] = [];
  const responded = agentSamples.filter((s) => s.responded);
  const withReqs = agentSamples.filter((s) => s.requirements !== null);

  // ── reachability ───────────────────────────────────────────────────────────
  if (responded.length === 0) {
    const why = agentSamples[0]?.error ?? "no response";
    return [
      { id: "reachable", status: "fail", weight: 100, detail: `No HTTP response across ${agentSamples.length} attempts: ${why}.` },
    ];
  }
  if (responded.length < agentSamples.length) {
    const lost = agentSamples.length - responded.length;
    signals.push({
      id: "reachable",
      status: "warn",
      weight: 18,
      detail: `${lost} of ${agentSamples.length} probes got no response — intermittent availability.`,
    });
  } else {
    signals.push({ id: "reachable", status: "pass", weight: 0, detail: `Responded to all ${agentSamples.length} probes.` });
  }

  // ── bot gating: an indexer cannot list what it cannot see ───────────────────
  const agentWalled = responded.some((s) => s.bodyText !== null && BOT_WALL.test(s.bodyText));
  const browserOk = browserSample?.responded === true && browserSample.status === 402;
  if (agentWalled && browserOk) {
    signals.push({
      id: "bot-gate",
      status: "fail",
      weight: 45,
      detail: `Bot wall answers the agent User-Agent but a browser gets a clean 402. Indexers cannot discover this endpoint — allow non-browser User-Agents, or disable Browser Integrity Check on this route.`,
    });
  } else if (agentWalled) {
    signals.push({
      id: "bot-gate",
      status: "fail",
      weight: 40,
      detail: "A bot wall is answering instead of the service. Agents will never reach the payment requirements.",
    });
  } else {
    signals.push({ id: "bot-gate", status: "pass", weight: 0, detail: "No bot wall between agents and the endpoint." });
  }

  // ── does it speak x402 at all ──────────────────────────────────────────────
  const statuses = [...new Set(responded.map((s) => s.status))];
  const paid402 = responded.filter((s) => s.status === 402);
  const openOk = responded.filter((s) => s.status !== null && s.status >= 200 && s.status < 300);

  if (withReqs.length === 0) {
    signals.push({
      id: "speaks-402",
      status: "fail",
      weight: 60,
      detail: `No parseable x402 payment requirements. Statuses seen: ${statuses.join(", ") || "none"}.`,
    });
  } else if (paid402.length === 0) {
    signals.push({
      id: "speaks-402",
      status: "warn",
      weight: 20,
      detail: `Payment requirements parsed, but no probe returned status 402 (saw ${statuses.join(", ")}).`,
    });
  } else if (paid402.length < responded.length) {
    signals.push({
      id: "speaks-402",
      status: "warn",
      weight: 12,
      detail: `Only ${paid402.length} of ${responded.length} probes returned 402 — inconsistent gating.`,
    });
  } else {
    signals.push({ id: "speaks-402", status: "pass", weight: 0, detail: "Returns 402 with parseable payment requirements." });
  }

  // ── is the paywall actually closed ─────────────────────────────────────────
  if (openOk.length > 0 && withReqs.length > 0) {
    signals.push({
      id: "gate-closed",
      status: "fail",
      weight: 35,
      detail: `${openOk.length} probe(s) got a 2xx with content and no payment. The resource advertises a price it does not enforce — anyone can take it for free.`,
    });
  } else if (openOk.length > 0) {
    signals.push({
      id: "gate-closed",
      status: "skip",
      weight: 0,
      detail: "Endpoint serves content openly and advertises no price. Not an x402 resource.",
    });
  } else {
    signals.push({ id: "gate-closed", status: "pass", weight: 0, detail: "Paywall holds — no unpaid probe received content." });
  }

  const options = withReqs.flatMap((s) => s.requirements?.accepts ?? []);
  if (options.length === 0) return signals;

  // ── price ──────────────────────────────────────────────────────────────────
  signals.push(...priceSignals(options, withReqs));

  // ── payout address ─────────────────────────────────────────────────────────
  signals.push(payToSignal(options));

  // ── network ────────────────────────────────────────────────────────────────
  signals.push(...networkSignals(options));

  // ── machine-readability ────────────────────────────────────────────────────
  signals.push(schemaSignal(options));
  signals.push(bazaarSignal(withReqs));

  // ── spec hygiene ───────────────────────────────────────────────────────────
  const warnings = [...new Set(withReqs.flatMap((s) => s.requirements?.warnings ?? []))];
  signals.push(
    warnings.length === 0
      ? { id: "spec-clean", status: "pass", weight: 0, detail: "Payload matches the documented shape." }
      : { id: "spec-clean", status: "warn", weight: 4 * warnings.length, detail: `Payload deviates from spec: ${warnings.join("; ")}.` },
  );

  return signals;
}

function priceSignals(options: PaymentOption[], withReqs: Observation[]): Signal[] {
  const out: Signal[] = [];
  const priced = options.filter((o) => o.priceUsd !== null);

  if (priced.length === 0) {
    out.push({
      id: "price-sane",
      status: "warn",
      weight: 25,
      detail: `Price in USD cannot be determined. The asset is not a stablecoin we recognize, or the scheme quotes a spending ceiling rather than a charge, so an agent cannot know what this call will actually cost.`,
    });
    return out;
  }

  const priceUsd = Math.min(...priced.map((o) => o.priceUsd as number));

  if (priceUsd <= 0) {
    out.push({ id: "price-sane", status: "warn", weight: 15, detail: "Advertised price is zero. Free endpoints do not need a 402." });
  } else if (priceUsd < PRICE_FLOOR_USD) {
    out.push({
      id: "price-sane",
      status: "warn",
      weight: 12,
      detail: `Price $${fmt(priceUsd)} is below the $${PRICE_FLOOR_USD} floor — too small to cover settlement, typical of leaderboard-farming stubs.`,
    });
  } else if (priceUsd > PRICE_CEILING_USD) {
    out.push({
      id: "price-sane",
      status: "fail",
      weight: 50,
      detail: `Price $${fmt(priceUsd)} exceeds the $${PRICE_CEILING_USD} ceiling. A single call at this price can drain an agent budget — treat as a price trap unless explicitly allowlisted.`,
    });
  } else {
    out.push({ id: "price-sane", status: "pass", weight: 0, detail: `Cheapest option $${fmt(priceUsd)} sits inside the sane band.` });
  }

  // A price that moves between two unpaid probes seconds apart is a red flag.
  const perProbe = withReqs
    .map((s) => {
      const amounts = (s.requirements?.accepts ?? [])
        .map((o) => o.priceUsd)
        .filter((n): n is number => n !== null);
      return amounts.length > 0 ? Math.min(...amounts) : null;
    })
    .filter((n): n is number => n !== null);
  const distinct = new Set(perProbe.map((n) => n.toFixed(9)));

  if (perProbe.length > 1 && distinct.size > 1) {
    out.push({
      id: "price-stable",
      status: "fail",
      weight: 40,
      detail: `Quoted price changed across probes taken seconds apart: ${[...distinct].map((d) => `$${fmt(Number(d))}`).join(" → ")}. Quotes are not stable enough to commit to.`,
    });
  } else if (perProbe.length > 1) {
    out.push({ id: "price-stable", status: "pass", weight: 0, detail: "Quote identical across every probe." });
  }

  return out;
}

function payToSignal(options: PaymentOption[]): Signal {
  const withPayTo = options.filter((o) => o.payTo !== null);
  if (withPayTo.length === 0) {
    return { id: "pay-to-valid", status: "fail", weight: 40, detail: "No payTo address declared — there is nobody to pay." };
  }

  const problems: string[] = [];
  const brokered: string[] = [];

  for (const o of withPayTo) {
    const addr = o.payTo as string;
    if (BURN_ADDRESSES.has(addr.toLowerCase())) {
      problems.push(`payTo on ${o.network} is a burn address (${addr}) — funds sent here are destroyed`);
      continue;
    }
    // Brokered settlement (AWS Marketplace and similar) names a URN, not a
    // wallet. Nothing is wrong with it, but the caller is trusting the broker
    // rather than a chain address, and should know that.
    if (isBrokeredPayout(addr, o.network)) {
      brokered.push(o.network);
      continue;
    }
    if (!addressMatchesNetwork(addr, o.network)) {
      problems.push(`payTo ${truncate(addr)} is not a valid address for network "${o.network}"`);
    }
  }

  if (problems.length > 0) {
    return { id: "pay-to-valid", status: "fail", weight: 45, detail: problems.join("; ") + "." };
  }
  if (brokered.length > 0) {
    return {
      id: "pay-to-valid",
      status: "warn",
      weight: 6,
      detail: `Settlement is brokered via ${[...new Set(brokered)].join(", ")} rather than paid to a chain address. Funds go to the broker, not directly to the operator.`,
    };
  }
  return { id: "pay-to-valid", status: "pass", weight: 0, detail: "Every payout address is well formed for its network." };
}

/** Non-chain settlement rails identify the payee by URN under a broker scheme. */
const BROKER_SCHEMES = /^(aws|gcp|azure|stripe):/i;

function isBrokeredPayout(addr: string, network: string): boolean {
  return addr.startsWith("urn:") && BROKER_SCHEMES.test(network);
}

function addressMatchesNetwork(addr: string, network: string): boolean {
  switch (addressFamily(network)) {
    case "solana":
      return SOLANA_ADDRESS.test(addr);
    case "algorand":
      return ALGORAND_ADDRESS.test(addr);
    case "evm":
      return EVM_ADDRESS.test(addr);
    default:
      // Unrecognized chain — accept any shape we know rather than cry wolf.
      return EVM_ADDRESS.test(addr) || SOLANA_ADDRESS.test(addr) || ALGORAND_ADDRESS.test(addr);
  }
}

function networkSignals(options: PaymentOption[]): Signal[] {
  const out: Signal[] = [];
  const networks = [...new Set(options.map((o) => o.network))];
  const unknown = [...new Set(options.filter((o) => !o.networkKnown).map((o) => o.networkRaw))];
  const mainnets = [
    ...new Set(options.filter((o) => !o.networkTestnet && o.network !== "unknown").map((o) => o.network)),
  ];

  if (mainnets.length === 0) {
    out.push({
      id: "network-mainnet",
      status: "fail",
      weight: 55,
      detail: `Only testnet networks offered (${networks.join(", ")}). This endpoint cannot accept real value.`,
    });
  } else {
    out.push({ id: "network-mainnet", status: "pass", weight: 0, detail: `Settles on mainnet: ${mainnets.join(", ")}.` });
  }

  const brokerRails = unknown.filter((n) => BROKER_SCHEMES.test(n));
  const trulyUnknown = unknown.filter((n) => !BROKER_SCHEMES.test(n));
  if (brokerRails.length > 0) {
    out.push({
      id: "network-broker",
      status: "warn",
      weight: 4,
      detail: `Offers brokered settlement rail(s): ${brokerRails.join(", ")}. Not a public chain — the broker holds the funds.`,
    });
  }
  if (trulyUnknown.length > 0) {
    out.push({
      id: "network-known",
      status: "warn",
      weight: 10,
      detail: `Unrecognized network identifier(s): ${trulyUnknown.join(", ")}. Confirm the chain before sending funds.`,
    });
  }

  return out;
}

function schemaSignal(options: PaymentOption[]): Signal {
  const withOutput = options.filter((o) => o.hasOutputSchema).length;
  const withInput = options.filter((o) => o.hasInputSchema).length;

  if (withOutput === 0 && withInput === 0) {
    return {
      id: "schema-advertised",
      status: "warn",
      weight: 15,
      detail: "No input or output schema. An agent has to pay before it can find out what it gets back.",
    };
  }
  if (withOutput === 0) {
    return { id: "schema-advertised", status: "warn", weight: 8, detail: "Input schema present, output schema missing — the response shape is unverifiable before paying." };
  }
  return { id: "schema-advertised", status: "pass", weight: 0, detail: "Call signature and response shape are both published." };
}

function bazaarSignal(withReqs: Observation[]): Signal {
  const meta = withReqs.map((s) => s.requirements?.bazaar).find((b) => b && (b.serviceName || b.tags.length > 0));
  if (!meta) {
    return {
      id: "bazaar-metadata",
      status: "warn",
      weight: 10,
      detail: "No serviceName or tags published. The resource can be indexed but not filtered, so agents searching by topic will not find it.",
    };
  }
  const bits: string[] = [];
  if (meta.serviceName) bits.push(`name "${meta.serviceName}"`);
  if (meta.tags.length > 0) bits.push(`tags [${meta.tags.join(", ")}]`);
  return { id: "bazaar-metadata", status: "pass", weight: 0, detail: `Discovery metadata published: ${bits.join(", ")}.` };
}

export function latencySignal(p99: number): Signal {
  if (p99 > P99_LATENCY_BUDGET_MS) {
    return {
      id: "latency",
      status: "fail",
      weight: 25,
      detail: `p99 ${Math.round(p99)}ms exceeds the ${P99_LATENCY_BUDGET_MS}ms budget agents typically allow.`,
    };
  }
  if (p99 > P99_LATENCY_BUDGET_MS / 2) {
    return { id: "latency", status: "warn", weight: 8, detail: `p99 ${Math.round(p99)}ms is slow but inside budget.` };
  }
  return { id: "latency", status: "pass", weight: 0, detail: `p99 ${Math.round(p99)}ms.` };
}

function fmt(n: number): string {
  if (n === 0) return "0";
  if (n < 0.01) return n.toFixed(6).replace(/0+$/, "");
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function truncate(s: string): string {
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

export { AGENT_UA, BROWSER_UA };
