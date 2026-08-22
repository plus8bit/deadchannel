import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { buy, operatingKey, quote } from "../src/hosaka/suppliers/buy.ts";
import { SUPPLIERS, SupplierError } from "../src/hosaka/suppliers/types.ts";
import type { Supplier } from "../src/hosaka/suppliers/types.ts";

/** A stand-in supplier whose price we control. */
let priceAtomic = "280000";
let server: ReturnType<typeof createServer>;
let stub: Supplier;

before(async () => {
  server = createServer((req, res) => {
    const required = {
      x402Version: 2,
      resource: { url: "http://stub/enrich" },
      accepts: [
        { scheme: "exact", network: "eip155:8453", amount: priceAtomic, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x0000000000000000000000000000000000000001", maxTimeoutSeconds: 60 },
      ],
    };
    res.writeHead(402, {
      "payment-required": Buffer.from(JSON.stringify(required)).toString("base64"),
      "content-type": "application/json",
    });
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  stub = { id: "stub", name: "Stub", url: `http://127.0.0.1:${port}/enrich`, method: "POST", listPriceUsd: 0.28, maxPriceUsd: 0.35 };
});

after(() => server.close());

describe("reading a supplier's price", () => {
  it("reads the Base mainnet price out of the 402", async () => {
    priceAtomic = "280000";
    assert.equal(await quote(stub), 0.28);
  });

  it("sees a reprice, rather than assuming the list price holds", async () => {
    // The whole reason to quote before buying: an endpoint can change its mind
    // between one call and the next.
    priceAtomic = "900000";
    assert.equal(await quote(stub), 0.9);
  });
});

describe("refusing to overpay", () => {
  it("will not buy above the ceiling", async () => {
    priceAtomic = "900000";
    await assert.rejects(
      () => buy(stub, {}, { privateKey: `0x${"11".repeat(32)}` }),
      (err: SupplierError) => {
        assert.equal(err.upstream, false, "refusing to overpay is our decision");
        assert.match(err.message, /ceiling is \$0\.35\. Not bought\./);
        return true;
      },
    );
  });

  it("names an unknown supplier as our mistake, not theirs", async () => {
    await assert.rejects(
      () => buy("nobody", {}),
      (err: SupplierError) => err.upstream === false && /unknown supplier/.test(err.message),
    );
  });

  it("refuses to buy with no operating key, and says why", async () => {
    await assert.rejects(
      () => buy("pdl-person", {}, {}),
      (err: SupplierError) => {
        assert.equal(err.upstream, false, "a missing key is ours, not the supplier's");
        assert.match(err.message, /payout address must never have its key on a server/);
        return true;
      },
    );
  });
});

describe("the operating key", () => {
  it("is read only when it is a usable key", () => {
    const good = `0x${"ab".repeat(32)}`;
    assert.equal(operatingKey({ HOSAKA_OPERATING_KEY: good }), good);
    assert.equal(operatingKey({ HOSAKA_OPERATING_KEY: "hunter2" }), null);
    assert.equal(operatingKey({}), null);
  });
});

describe("the supplier list", () => {
  it("gives every supplier a ceiling above its list price", () => {
    for (const s of Object.values(SUPPLIERS)) {
      assert.ok(s.maxPriceUsd > s.listPriceUsd, `${s.id} has no headroom`);
      assert.match(s.url, /^https:\/\//, `${s.id} must be https`);
    }
  });

  it("keeps ceilings within a sane margin of the list price", () => {
    // A ceiling far above list is not a ceiling; it is permission to be robbed.
    for (const s of Object.values(SUPPLIERS)) {
      assert.ok(s.maxPriceUsd <= s.listPriceUsd * 1.75, `${s.id} ceiling is too loose`);
    }
  });
});

describe("the resale shelf", () => {
  it("is priced below the market leader while carrying more", async () => {
    const { PRICE_BUNDLE } = await import("../src/hosaka/server/bundle.ts");
    const cost = SUPPLIERS["fullenrich-people"]!.listPriceUsd;
    // PDL Person Enrich, the top earner in this whole market, sells contacts
    // alone at $0.28. Undercutting it while adding a dossier is the position.
    assert.ok(PRICE_BUNDLE < 0.28, "must undercut the leader");
    assert.ok(PRICE_BUNDLE > cost, "must cover what the contacts cost us");
    assert.ok(PRICE_BUNDLE - cost >= 0.15, `margin is only $${(PRICE_BUNDLE - cost).toFixed(2)}`);
  });

  it("declares an inferred request shape instead of hiding it", () => {
    const s = SUPPLIERS["fullenrich-people"]!;
    assert.ok(s.byDomain, "the shelf needs a domain lookup");
    assert.equal(s.byDomain?.unverified, true, "this supplier publishes no input schema");
    assert.deepEqual(s.byDomain?.build("figma.com"), { company_domain: "figma.com" });
  });

  it("cannot sell the bundle without an operating wallet, and says so", async () => {
    const { runBundle } = await import("../src/hosaka/server/bundle.ts");
    await assert.rejects(
      () => runBundle({ domain: "figma.com" }),
      (err: SupplierError) => {
        // Throwing is what keeps the buyer from paying for half an answer:
        // the payment layer settles only after the handler returns.
        assert.equal(err.upstream, false);
        assert.match(err.message, /HOSAKA_OPERATING_KEY/);
        return true;
      },
    );
  });
});
