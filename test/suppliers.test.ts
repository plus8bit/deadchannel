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
      // A ratio floor was the wrong shape for a shelf whose supplier sells the
      // same answer in the same catalog: demanding 1.5x put us above the
      // original seller, which is exactly why an agent searching for this
      // never chose us. What has to hold is an absolute margin at the worst
      // price we would still pay, not a multiple of the best one.
      // Held as a share of the shelf rather than a flat sum, so it means the
      // same thing on a two-cent shelf and a twenty-one-cent one.
      const kept = tier.priceUsd - supplier.maxPriceUsd;
      assert.ok(
        kept >= tier.priceUsd * 0.15,
        `${name} keeps only $${kept.toFixed(3)} of $${tier.priceUsd} in the worst case`,
      );
      // The ceiling, not the list price, is what we can actually be charged.
      // If a supplier repriced itself all the way up to its ceiling and we
      // still sold at today's price, this is the line that says we survive it.
      assert.ok(
        tier.priceUsd > supplier.maxPriceUsd,
        `${name} sells at $${tier.priceUsd} but may be charged up to $${supplier.maxPriceUsd}`,
      );
    }
  });

  it("costs no more than buying the two halves apart", async () => {
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    const { PRICE_DOSSIER } = await import("../src/hosaka/server/routes.ts");
    // The claim this shelf makes is the pairing, not the contacts: a buyer can
    // always purchase the stack from us and the people from our own supplier,
    // who is listed in the same catalog. If the bundle ever costs more than
    // that sum, the shelf is asking to be skipped, and an agent that compares
    // prices will skip it.
    const apart = PRICE_DOSSIER + SUPPLIERS["fullenrich-people"]!.listPriceUsd;
    assert.ok(
      TIERS.people.priceUsd <= apart,
      `bundle $${TIERS.people.priceUsd} vs $${apart.toFixed(3)} bought separately`,
    );
  });

  it("keeps the two tiers distinguishable in the response", async () => {
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    const kinds = Object.values(TIERS).map((t) => t.kind);
    // Named people and a scrape of a company's own published addresses are
    // different answers at a fifty-fold price difference. A buyer who cannot
    // tell which one arrived cannot tell whether they got what they paid for.
    assert.equal(new Set(kinds).size, kinds.length, "tiers must not share a kind");
  });

  it("carries no unproven mapping into a shelf that is being sold", () => {
    // Both were established by paying, and cheaply. OpenWebNinja named its
    // field when one request carried a different value in each candidate
    // parameter; FullEnrich named its own in a 400 that landed before
    // settlement, and a second call returned people, which is what proves the
    // shape rather than just the name.
    //
    // The flag stays in the type on purpose: the next supplier starts as a
    // guess, and the response says so until it is not.
    for (const s of Object.values(SUPPLIERS)) {
      if (!s.byDomain) continue;
      assert.equal(s.byDomain.unverified, undefined, `${s.id} is still selling on a guess`);
    }
    assert.deepEqual(SUPPLIERS["fullenrich-people"]!.byDomain?.build("figma.com"), {
      current_company_domains: ["figma.com"],
    });
    assert.deepEqual(SUPPLIERS["openwebninja-contacts"]!.byDomain?.build("figma.com"), {
      query: "figma.com",
    });
  });

  it("puts parameters where a GET supplier can actually read them", async () => {
    const { requestUrl } = await import("../src/hosaka/suppliers/buy.ts");
    const get = SUPPLIERS["openwebninja-contacts"]!;
    const url = new URL(requestUrl(get, get.byDomain!.build("figma.com")));
    // A GET has no body. Sending one looks like it works — the payment settles
    // and a 200 comes back — but the endpoint answered a question we never
    // asked and we paid for it.
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

describe("asking a supplier what it wants", () => {
  it("still refuses a real order the wallet cannot cover", async () => {
    const { buy } = await import("../src/hosaka/suppliers/buy.ts");
    const { SUPPLIERS } = await import("../src/hosaka/suppliers/types.ts");
    // An empty wallet must not take an order. The probe path is the exception,
    // and it exists because a refused request costs nothing and is the only
    // free description these endpoints publish.
    await assert.rejects(
      () => buy(SUPPLIERS["fullenrich-people"]!, {}, { privateKey: undefined as never }),
      /HOSAKA_OPERATING_KEY/,
    );
  });

  it("keeps enough of a rejection to read what it asked for", async () => {
    const { SupplierError } = await import("../src/hosaka/suppliers/types.ts");
    // The 200-character cut landed mid-sentence in the one message that named
    // the supplier's own filters, and we paid $0.15 to learn what it had
    // already begun to say.
    const long = "Provide at least one search filter (e.g. " + "field_name, ".repeat(60);
    const err = new SupplierError("x", `returned 400. ${long.slice(0, 2000)}`);
    assert.ok(err.message.length > 400, "a rejection must survive long enough to be read");
  });
});

describe("what a young market does to a year count", () => {
  it("publishes the registration date, not only the floored age", async () => {
    const { LOOKUP_ROUTE } = await import("../src/hosaka/server/routes.ts");
    const example = LOOKUP_ROUTE.outputExample as Record<string, unknown>;
    // Eleven of the eighteen busiest x402 sellers profile as ageYears 0, which
    // is true and useless: the protocol is barely older than that. The date
    // survives the flooring, so it is the field that still separates a domain
    // registered last month from one registered last year.
    assert.ok("registeredOn" in example, "the example must show the date a buyer needs");
    assert.ok("ageYears" in example, "the year count stays for anyone who only wants that");
  });
});
