import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runChecks } from "../src/probe/checks.ts";
import type { Observation } from "../src/probe/observe.ts";
import { AGENT_UA } from "../src/probe/observe.ts";
import { parsePaymentRequirements } from "../src/probe/parse.ts";
import { decideVerdict, scoreRisk } from "../src/probe/score.ts";
import type { Verdict } from "../src/probe/types.ts";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const GOOD_PAYTO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

function requirements(overrides: Record<string, unknown> = {}, root: Record<string, unknown> = {}) {
  return {
    x402Version: 1,
    ...root,
    accepts: [
      {
        scheme: "exact",
        network: "base",
        maxAmountRequired: "2500",
        asset: USDC_BASE,
        payTo: GOOD_PAYTO,
        maxTimeoutSeconds: 60,
        outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
        extra: { name: "USDC", version: "2" },
        serviceName: "quotes",
        tags: ["price", "defi"],
        ...overrides,
      },
    ],
  };
}

function sample(body: unknown, status = 402, ms = 120): Observation {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    responded: true,
    status,
    error: null,
    ms,
    bodyText: text,
    bodyBytes: Buffer.byteLength(text),
    contentType: "application/json",
    serverHeader: null,
    requirements: typeof body === "string" ? null : parsePaymentRequirements(body),
    userAgent: AGENT_UA,
  };
}

function verdictOf(samples: Observation[], browserSample: Observation | null = null): {
  verdict: Verdict;
  risk: number;
  ids: string[];
} {
  const signals = runChecks({ agentSamples: samples, browserSample });
  const risk = scoreRisk(signals);
  return {
    verdict: decideVerdict(signals, risk),
    risk,
    ids: signals.filter((s) => s.status === "fail").map((s) => s.id),
  };
}

describe("verdicts", () => {
  it("calls a well-formed mainnet endpoint live", () => {
    const { verdict, risk } = verdictOf([sample(requirements()), sample(requirements())]);
    assert.equal(verdict, "live");
    assert.ok(risk < 25, `risk should be low, got ${risk}`);
  });

  it("calls an unreachable endpoint dead", () => {
    const dead: Observation = {
      responded: false, status: null, error: "timed out", ms: 10000,
      bodyText: null, bodyBytes: 0, contentType: null, serverHeader: null,
      requirements: null, userAgent: AGENT_UA,
    };
    assert.equal(verdictOf([dead, dead]).verdict, "dead");
  });

  it("calls an over-ceiling price a trap", () => {
    // 50 USDC per call — one call can drain an agent's daily budget.
    const pricey = requirements({ maxAmountRequired: "50000000" });
    const { verdict, ids } = verdictOf([sample(pricey), sample(pricey)]);
    assert.equal(verdict, "trap");
    assert.ok(ids.includes("price-sane"));
  });

  it("calls a burn payout address a trap", () => {
    const burned = requirements({ payTo: "0x0000000000000000000000000000000000000000" });
    const { verdict, ids } = verdictOf([sample(burned)]);
    assert.equal(verdict, "trap");
    assert.ok(ids.includes("pay-to-valid"));
  });

  it("calls a quote that moves between probes a trap", () => {
    const { verdict, ids } = verdictOf([
      sample(requirements({ maxAmountRequired: "2500" })),
      sample(requirements({ maxAmountRequired: "9000" })),
    ]);
    assert.equal(verdict, "trap");
    assert.ok(ids.includes("price-stable"));
  });

  it("calls a testnet-only endpoint testnet, not dead", () => {
    const testnet = requirements({ network: "base-sepolia" });
    assert.equal(verdictOf([sample(testnet)]).verdict, "testnet");
  });

  it("calls a bot-walled endpoint dead and names the browser asymmetry", () => {
    const walled = sample("<html><title>Just a moment...</title></html>", 403);
    const browser = sample(requirements(), 402);
    const signals = runChecks({ agentSamples: [walled], browserSample: browser });
    const gate = signals.find((s) => s.id === "bot-gate");
    assert.equal(gate?.status, "fail");
    assert.match(gate?.detail ?? "", /browser gets a clean 402/);
    assert.equal(decideVerdict(signals, scoreRisk(signals)), "dead");
  });

  it("flags a paywall that serves content for free", () => {
    const { ids } = verdictOf([sample(requirements(), 402), sample({ result: "secret data" }, 200)]);
    assert.ok(ids.includes("gate-closed"), "an unenforced paywall must fail gate-closed");
  });

  it("calls a plain unpriced API not-x402 rather than dead", () => {
    const open = sample({ result: "public data" }, 200);
    assert.equal(verdictOf([open, open]).verdict, "unknown");
  });

  it("scores risk on a bounded 0-100 scale", () => {
    const awful = requirements({ maxAmountRequired: "999000000", payTo: "0x0", network: "eip155:99999" });
    const { risk } = verdictOf([sample(awful), sample(awful)]);
    assert.ok(risk > 0 && risk <= 100, `risk out of range: ${risk}`);
  });
});
