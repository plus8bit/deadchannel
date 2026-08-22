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

describe("the resale shelves", () => {
  it("prices every tier above what its supplier costs", async () => {
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    for (const [name, tier] of Object.entries(TIERS)) {
      const supplier = SUPPLIERS[tier.supplier]!;
      assert.ok(tier.priceUsd > supplier.listPriceUsd, `${name} sells below cost`);
      assert.ok(tier.priceUsd / supplier.listPriceUsd >= 1.5, `${name} markup is too thin`);
      // The ceiling, not the list price, is what we can actually be charged.
      // If a supplier repriced itself all the way up to its ceiling and we
      // still sold at today's price, this is the line that says we survive it.
      assert.ok(
        tier.priceUsd > supplier.maxPriceUsd,
        `${name} sells at $${tier.priceUsd} but may be charged up to $${supplier.maxPriceUsd}`,
      );
    }
  });

  it("undercuts the market leader on the tier that competes with it", async () => {
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    // PDL Person Enrich, the top earner in this whole market, sells contacts
    // alone at $0.28. Undercutting it while adding a dossier is the position.
    assert.ok(TIERS.people.priceUsd < 0.28, "must undercut the leader");
    assert.ok(TIERS.people.priceUsd - SUPPLIERS["fullenrich-people"]!.listPriceUsd >= 0.08);
  });

  it("keeps the two tiers distinguishable in the response", async () => {
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    const kinds = Object.values(TIERS).map((t) => t.kind);
    // Named people and a scrape of a company's own published addresses are
    // different answers at a fifty-fold price difference. A buyer who cannot
    // tell which one arrived cannot tell whether they got what they paid for.
    assert.equal(new Set(kinds).size, kinds.length, "tiers must not share a kind");
  });

  it("declares an inferred request shape instead of hiding it", () => {
    for (const s of Object.values(SUPPLIERS)) {
      if (!s.byDomain) continue;
      // Every supplier we buy from by domain publishes no input schema, so
      // every mapping is inferred. The day one of them documents itself, this
      // assertion is what forces the flag to be dropped rather than left lying.
      assert.equal(s.byDomain.unverified, true, `${s.id} mapping must be marked inferred`);
    }
    assert.deepEqual(SUPPLIERS["fullenrich-people"]!.byDomain?.build("figma.com"), {
      company_domain: "figma.com",
    });
  });

  it("puts parameters where a GET supplier can actually read them", async () => {
    const { requestUrl } = await import("../src/hosaka/suppliers/buy.ts");
    const get = SUPPLIERS["openwebninja-contacts"]!;
    const url = new URL(requestUrl(get, get.byDomain!.build("figma.com")));
    // A GET has no body. Sending one looks like it works — the payment settles
    // and a 200 comes back — but the endpoint answered a question we never
    // asked and we paid for it.
    assert.equal(url.searchParams.get("domain"), "figma.com");
    assert.equal(url.searchParams.get("query"), "figma.com");

    const post = SUPPLIERS["fullenrich-people"]!;
    assert.equal(requestUrl(post, { company_domain: "figma.com" }), post.url, "a POST keeps its body");
  });

  it("cannot sell a bundle without an operating wallet, and says so", async () => {
    const { runBundle } = await import("../src/hosaka/server/bundle.ts");
    await assert.rejects(
      () => runBundle({ domain: "figma.com" }, "people"),
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
