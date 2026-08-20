import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { parsePaymentRequirements } from "../src/probe/parse.ts";
import { loadConfig } from "../src/server/config.ts";
import type { Config } from "../src/server/config.ts";
import { FacilitatorClient } from "../src/server/facilitator.ts";
import type { SettleResponse, VerifyResponse } from "../src/server/facilitator.ts";
import { createApp } from "../src/server/app.ts";
import type { Deps } from "../src/server/app.ts";
import type { ProbeResponse } from "../src/server/routes.ts";
import { HEADER_REQUIRED, HEADER_RESPONSE, HEADER_SIGNATURE, encodeHeader } from "../src/server/x402.ts";

const PAY_TO = "0x712c78928080Adb009E31315c0c3c7473dA9648a";

const cfg: Config = loadConfig({
  X402_PAY_TO: PAY_TO,
  X402_NETWORK: "base",
  X402_PRICE_USD: "0.001",
  PUBLIC_URL: "https://deadchannel.test",
});

/** Records what the server asked the facilitator to do. */
class StubFacilitator extends FacilitatorClient {
  verifyCalls = 0;
  settleCalls = 0;
  verifyResult: VerifyResponse = { isValid: true, payer: "0xBuyer" };
  settleResult: SettleResponse = { success: true, transaction: "0xdeadbeef", payer: "0xBuyer" };

  constructor() {
    super("http://stub.invalid");
  }
  override async verify(): Promise<VerifyResponse> {
    this.verifyCalls++;
    return this.verifyResult;
  }
  override async settle(): Promise<SettleResponse> {
    this.settleCalls++;
    return this.settleResult;
  }
}

const PROBE_RESULT: ProbeResponse = {
  url: "https://api.example.com/paid",
  verdict: "degraded",
  risk: 25,
  priceUsd: 0.01,
  networks: ["base"],
  latencyMs: { p50: 180, p99: 240 },
  problems: [{ id: "schema-advertised", status: "warn", detail: "No schema." }],
  checksPassed: 9,
  checksRun: 11,
  probedAt: "2026-08-20T00:00:00.000Z",
};

let facilitator: StubFacilitator;
let deps: Deps & { calls: number; fail: boolean };
let server: ReturnType<typeof createApp>;
let base: string;

before(async () => {
  facilitator = new StubFacilitator();
  deps = {
    calls: 0,
    fail: false,
    runProbe: async () => {
      deps.calls++;
      if (deps.fail) throw new Error("probe exploded");
      return PROBE_RESULT;
    },
  };
  server = createApp(cfg, facilitator, deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

function reset(): void {
  facilitator.verifyCalls = 0;
  facilitator.settleCalls = 0;
  facilitator.verifyResult = { isValid: true, payer: "0xBuyer" };
  facilitator.settleResult = { success: true, transaction: "0xdeadbeef", payer: "0xBuyer" };
  deps.calls = 0;
  deps.fail = false;
}

/** A payload that agrees with exactly the terms the server advertises. */
function validSignature(overrides: Record<string, unknown> = {}): string {
  return encodeHeader({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
      extra: { name: "USDC", version: "2" },
      ...overrides,
    },
    payload: { signature: "0xsig", authorization: {} },
  });
}

function post(body: unknown, signature?: string): Promise<Response> {
  return fetch(`${base}/probe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { [HEADER_SIGNATURE]: signature } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("unpaid requests", () => {
  it("answers 402 with a PAYMENT-REQUIRED header", async () => {
    reset();
    const res = await post({ url: "https://api.example.com/paid" });
    assert.equal(res.status, 402);
    assert.ok(res.headers.get(HEADER_REQUIRED), "header must be present");
    assert.equal(facilitator.verifyCalls, 0);
    assert.equal(deps.calls, 0, "the resource must not run unpaid");
  });

  it("emits payment requirements our own parser can read", async () => {
    reset();
    const res = await post({ url: "https://api.example.com/paid" });
    const decoded = JSON.parse(
      Buffer.from(res.headers.get(HEADER_REQUIRED) as string, "base64").toString("utf8"),
    );
    const parsed = parsePaymentRequirements(decoded);

    assert.ok(parsed, "our probe parser must understand our own 402");
    assert.equal(parsed.x402Version, 2);
    assert.equal(parsed.accepts[0]?.network, "base");
    assert.equal(parsed.accepts[0]?.networkTestnet, false);
    assert.equal(parsed.accepts[0]?.amountDecimal, 0.001, "$0.001 must decode back to $0.001");
    assert.equal(parsed.accepts[0]?.payTo, PAY_TO);
    assert.deepEqual(parsed.warnings, [], "our own payload must be spec-clean");
  });

  it("publishes the discovery metadata 89.8% of the catalog omits", async () => {
    reset();
    const res = await post({ url: "https://api.example.com/paid" });
    const decoded = JSON.parse(
      Buffer.from(res.headers.get(HEADER_REQUIRED) as string, "base64").toString("utf8"),
    );
    assert.equal(decoded.resource.serviceName, "deadchannel");
    assert.ok(decoded.resource.tags.length > 0 && decoded.resource.tags.length <= 5);
    assert.ok(decoded.extensions.bazaar.info.input, "input descriptor required for discovery");
    assert.ok(decoded.extensions.bazaar.info.output, "output example required for discovery");
  });
});

describe("payment validation", () => {
  it("rejects a payload that pays a different address", async () => {
    reset();
    const res = await post(
      { url: "https://api.example.com/paid" },
      validSignature({ payTo: "0x000000000000000000000000000000000000dEaD" }),
    );
    assert.equal(res.status, 402);
    assert.match(((await res.json()) as { reason: string }).reason, /payTo/);
    assert.equal(facilitator.verifyCalls, 0, "never ask the facilitator about wrong terms");
  });

  it("rejects a payload that underpays", async () => {
    reset();
    const res = await post({ url: "https://api.example.com/paid" }, validSignature({ amount: "1" }));
    assert.equal(res.status, 402);
    assert.match(((await res.json()) as { reason: string }).reason, /amount/);
    assert.equal(deps.calls, 0);
  });

  it("rejects a payload for another network", async () => {
    reset();
    const res = await post(
      { url: "https://api.example.com/paid" },
      validSignature({ network: "eip155:84532" }),
    );
    assert.equal(res.status, 402);
    assert.match(((await res.json()) as { reason: string }).reason, /network/);
  });

  it("rejects when the facilitator says the payment is invalid", async () => {
    reset();
    facilitator.verifyResult = { isValid: false, invalidReason: "insufficient_funds" };
    const res = await post({ url: "https://api.example.com/paid" }, validSignature());
    assert.equal(res.status, 402);
    assert.equal(((await res.json()) as { reason: string }).reason, "insufficient_funds");
    assert.equal(deps.calls, 0, "the resource must not run on an invalid payment");
    assert.equal(facilitator.settleCalls, 0);
  });
});

describe("paid requests", () => {
  it("verifies, runs the probe, settles, and returns the result", async () => {
    reset();
    const res = await post({ url: "https://api.example.com/paid" }, validSignature());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), PROBE_RESULT);
    assert.equal(facilitator.verifyCalls, 1);
    assert.equal(deps.calls, 1);
    assert.equal(facilitator.settleCalls, 1);
  });

  it("returns the settlement receipt in PAYMENT-RESPONSE", async () => {
    reset();
    const res = await post({ url: "https://api.example.com/paid" }, validSignature());
    const receipt = JSON.parse(
      Buffer.from(res.headers.get(HEADER_RESPONSE) as string, "base64").toString("utf8"),
    );
    assert.equal(receipt.success, true);
    assert.equal(receipt.transaction, "0xdeadbeef");
  });

  it("does not settle when the probe fails, so a failure is free", async () => {
    reset();
    deps.fail = true;
    const res = await post({ url: "https://api.example.com/paid" }, validSignature());
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as { error: string }).error, /not charged/);
    assert.equal(facilitator.verifyCalls, 1);
    assert.equal(facilitator.settleCalls, 0, "a failed resource must never be settled");
  });

  it("reports a failed settlement instead of pretending it worked", async () => {
    reset();
    facilitator.settleResult = { success: false, errorReason: "insufficient_funds", transaction: "" };
    const res = await post({ url: "https://api.example.com/paid" }, validSignature());
    assert.equal(res.status, 402);
    assert.equal(((await res.json()) as { reason: string }).reason, "insufficient_funds");
  });
});

describe("input validation", () => {
  it("rejects a missing url before touching the facilitator", async () => {
    reset();
    const res = await post({}, validSignature());
    assert.equal(res.status, 400);
    assert.equal(facilitator.verifyCalls, 0);
  });

  it("refuses private hosts so it cannot be used as an SSRF relay", async () => {
    reset();
    for (const url of ["http://localhost:22", "http://127.0.0.1/admin", "http://10.0.0.1", "http://169.254.169.254/latest/meta-data"]) {
      const res = await post({ url }, validSignature());
      assert.equal(res.status, 400, `${url} must be refused`);
    }
    assert.equal(deps.calls, 0);
  });

  it("refuses non-http schemes", async () => {
    reset();
    const res = await post({ url: "file:///etc/passwd" }, validSignature());
    assert.equal(res.status, 400);
  });
});

describe("free endpoints", () => {
  it("serves a machine-readable service card", async () => {
    const card = (await (await fetch(`${base}/`)).json()) as {
      service: string;
      payment: { payTo: string; price: string };
    };
    assert.equal(card.service, "deadchannel");
    assert.equal(card.payment.payTo, PAY_TO);
    assert.equal(card.payment.price, "$0.001 USDC");
  });

  it("answers health without payment", async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { ok: boolean }).ok, true);
  });
});

describe("advertised payment terms", () => {
  it("advertises the mainnet USDC domain, not the testnet one", async () => {
    reset();
    const res = await post({ url: "https://api.example.com/paid" });
    const decoded = JSON.parse(
      Buffer.from(res.headers.get(HEADER_REQUIRED) as string, "base64").toString("utf8"),
    ) as { accepts: { extra: { name: string; version: string }; asset: string }[] };

    assert.equal(decoded.accepts[0]?.extra.name, "USD Coin");
    assert.equal(decoded.accepts[0]?.extra.version, "2");
    assert.equal(decoded.accepts[0]?.asset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });
});
