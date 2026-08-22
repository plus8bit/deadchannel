import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/server/config.ts";
import type { Config } from "../src/server/config.ts";
import { FacilitatorClient, FacilitatorError } from "../src/server/facilitator.ts";
import { BadInput, applyOutcome, servePaid } from "../src/server/paid.ts";
import { HEADER_REQUIRED, HEADER_SIGNATURE, encodeHeader } from "../src/server/x402.ts";
import type { PaidRoute } from "../src/server/x402.ts";

const PAY_TO = "0x712c78928080Adb009E31315c0c3c7473dA9648a";
const cfg: Config = loadConfig({ X402_PAY_TO: PAY_TO, X402_NETWORK: "base", PUBLIC_URL: "https://shop.test" });

const route: PaidRoute = {
  path: "/thing", method: "POST", serviceName: "shop",
  description: "A thing", tags: ["t"], mimeType: "application/json",
  inputExample: { q: "x" }, inputSchema: { type: "object" }, outputExample: { ok: true },
};

/** A facilitator we can make fail in specific, realistic ways. */
class Stub extends FacilitatorClient {
  verifyThrows: unknown = null;
  settleThrows: unknown = null;
  constructor() { super("http://stub.invalid"); }
  override async verify() {
    if (this.verifyThrows) throw this.verifyThrows;
    return { isValid: true, payer: "0xBuyer" };
  }
  override async settle() {
    if (this.settleThrows) throw this.settleThrows;
    return { success: true, transaction: "0xtx" };
  }
}

let stub: Stub;
let server: ReturnType<typeof createServer>;
let base: string;

before(async () => {
  stub = new Stub();
  server = createServer((req, res) => {
    servePaid(req, cfg, stub, {
      route,
      parse: (body) => {
        const q = (body as Record<string, unknown>)["q"];
        if (typeof q !== "string") throw new BadInput("`q` is required");
        return { q };
      },
      run: async (r) => ({ echoed: r.q }),
      priceUsd: 0.02,
    }).then((o) => applyOutcome(res, o));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const signature = () =>
  encodeHeader({
    x402Version: 2,
    accepted: {
      scheme: "exact", network: "eip155:8453", amount: "20000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: PAY_TO,
      maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" },
    },
    payload: { signature: "0xsig", authorization: {} },
  });

const post = (paid: boolean, body: unknown = { q: "hello" }) =>
  fetch(`${base}/thing`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(paid ? { [HEADER_SIGNATURE]: signature() } : {}) },
    body: JSON.stringify(body),
  });

function reset() { stub.verifyThrows = null; stub.settleThrows = null; }

describe("per-SKU pricing", () => {
  it("advertises the route's own price, not the config default", async () => {
    reset();
    const res = await post(false);
    const d = JSON.parse(Buffer.from(res.headers.get(HEADER_REQUIRED) as string, "base64").toString());
    assert.equal(d.accepts[0].amount, "20000", "$0.02 must be 20000 atomic, whatever the config says");
  });

  it("accepts a payload signed for that same price", async () => {
    reset();
    const res = await post(true);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { echoed: "hello" });
  });
});

describe("whose fault is it", () => {
  it("calls a facilitator refusal a payment problem, not an outage", async () => {
    // An empty wallet must not read as "our service is down": one of those the
    // buyer can fix, the other they can only wait out.
    reset();
    stub.verifyThrows = new FacilitatorError("bad", 400, JSON.stringify({ invalidReason: "insufficient_funds" }));
    const res = await post(true);
    assert.equal(res.status, 402);
    assert.deepEqual(await res.json(), { error: "payment invalid", reason: "insufficient_funds" });
  });

  it("still offers the terms again on a refusal, so a client can retry", async () => {
    reset();
    stub.verifyThrows = new FacilitatorError("bad", 402, JSON.stringify({ invalidReason: "expired" }));
    assert.ok((await post(true)).headers.get(HEADER_REQUIRED));
  });

  it("owns a facilitator outage as ours", async () => {
    reset();
    stub.verifyThrows = new FacilitatorError("down", 503, "gateway");
    const res = await post(true);
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as { error: string }).error, /unavailable/);
  });

  it("owns a network failure as ours", async () => {
    reset();
    stub.verifyThrows = new FacilitatorError("timed out", null, null);
    assert.equal((await post(true)).status, 502);
  });

  it("reports a refused settlement without claiming to have charged", async () => {
    reset();
    stub.settleThrows = new FacilitatorError("no", 400, JSON.stringify({ errorReason: "insufficient_funds" }));
    const res = await post(true);
    assert.equal(res.status, 402);
    assert.equal(((await res.json()) as { reason: string }).reason, "insufficient_funds");
  });

  it("falls back to the raw body when a refusal is not JSON", async () => {
    reset();
    stub.verifyThrows = new FacilitatorError("bad", 400, "Unauthorized");
    assert.equal(((await (await post(true)).json()) as { reason: string }).reason, "Unauthorized");
  });
});

describe("input handling", () => {
  it("rejects a bad body before asking the facilitator anything", async () => {
    reset();
    stub.verifyThrows = new Error("must not be reached");
    const res = await post(true, { nope: 1 });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /`q` is required/);
  });
});
