import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isAlgorandAddress,
  algorandOption,
  ALGORAND_MAINNET,
  USDC_ASA_MAINNET,
  CHALLENGE_TAG,
  GOPLAUSIBLE_FEE_PAYER,
} from "../src/server/algorand.ts";
import { loadConfig } from "../src/server/config.ts";
import { buildPaymentRequired } from "../src/server/x402.ts";

const REAL = "NLT4P2QFI3OO3PTLQHQXCAM2RA2Y7T4RZZKZF43BLMBKDFPFX54ZLDY2JU";

describe("Algorand addresses", () => {
  it("accepts a real one", () => {
    assert.ok(isAlgorandAddress(REAL));
    assert.ok(isAlgorandAddress("C7IIHG7SPLPZ5H7ZT6HW3UV2OQMQQE6Y2HBNGZXSLRJULE42BEE2OY2XIE"));
  });

  it("catches a single mistyped character", () => {
    // The whole reason to verify the checksum rather than the shape: a payout
    // address that is one character wrong is still 58 valid base32 characters,
    // and money sent there belongs to nobody.
    for (let i = 0; i < REAL.length; i += 7) {
      const wrong = REAL[i] === "A" ? "B" : "A";
      const typo = REAL.slice(0, i) + wrong + REAL.slice(i + 1);
      assert.equal(isAlgorandAddress(typo), false, `typo at ${i} slipped through`);
    }
  });

  it("rejects addresses from other chains and other shapes", () => {
    assert.equal(isAlgorandAddress("0x712c78928080Adb009E31315c0c3c7473dA9648a"), false);
    assert.equal(isAlgorandAddress(REAL.toLowerCase()), false, "base32 here is uppercase");
    assert.equal(isAlgorandAddress(REAL.slice(0, 57)), false);
    assert.equal(isAlgorandAddress(REAL + "A"), false);
    assert.equal(isAlgorandAddress(""), false);
    assert.equal(isAlgorandAddress("1".repeat(58)), false, "1 and 0 are not in base32");
  });
});

describe("selling on Algorand as well as Base", () => {
  const base = {
    X402_NETWORK: "base",
    X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
    X402_PRICE_USD: "0.01",
    PUBLIC_URL: "https://example.test",
  };
  const route = {
    path: "/lookup",
    method: "POST" as const,
    serviceName: "Test",
    description: "d",
    tags: ["t"],
    mimeType: "application/json",
    inputExample: {},
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
    outputExample: {},
  };

  it("offers only Base until an Algorand address is configured", () => {
    const cfg = loadConfig(base, {});
    const req = buildPaymentRequired(cfg, route, "payment required");
    assert.equal(req.accepts.length, 1);
    assert.equal(req.accepts[0]!.network, "eip155:8453");
  });

  it("adds Algorand without disturbing Base, at the same price", () => {
    const cfg = loadConfig({ ...base, X402_ALGORAND_PAY_TO: REAL }, {});
    const req = buildPaymentRequired(cfg, route, "payment required");
    assert.equal(req.accepts.length, 2);

    const [evm, algo] = req.accepts;
    // Base must be untouched: the chain that already takes real money is the
    // one an experiment must not break.
    assert.equal(evm!.network, "eip155:8453");
    assert.equal(evm!.payTo, base.X402_PAY_TO);

    assert.equal(algo!.network, ALGORAND_MAINNET);
    assert.equal(algo!.asset, USDC_ASA_MAINNET, "Algorand names an asset by integer id");
    assert.equal(algo!.payTo, REAL);
    assert.equal(algo!.amount, evm!.amount, "same price on both chains");
    assert.equal((algo!.extra as Record<string, unknown>)["tag"], CHALLENGE_TAG);
    assert.equal((algo!.extra as Record<string, unknown>)["feePayer"], GOPLAUSIBLE_FEE_PAYER);
  });

  it("refuses to boot on a malformed Algorand address rather than ignoring it", () => {
    // Silently dropping it would leave the endpoint out of the challenge with
    // no sign of why.
    assert.throws(() => loadConfig({ ...base, X402_ALGORAND_PAY_TO: REAL.slice(0, 57) + "A" }, {}), /checksum/);
  });

  it("keeps the fee payer off the payout address", () => {
    // The sponsor pays the network fee; it must never be where funds land.
    const o = algorandOption({ payTo: REAL, testnet: false }, "10000", 120);
    assert.notEqual(o.payTo, GOPLAUSIBLE_FEE_PAYER);
  });
});

describe("routing a payment to a facilitator that can settle it", () => {
  const base = {
    X402_NETWORK: "base",
    X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
    X402_ALGORAND_PAY_TO: REAL,
    X402_FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
    PUBLIC_URL: "https://example.test",
    // CDP refuses to construct a client without credentials, which is correct
    // and unrelated to what this test is about. Nothing is ever sent.
    CDP_API_KEY_ID: "00000000-0000-0000-0000-000000000000",
    CDP_API_KEY_SECRET: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw==",
  };

  it("sends Algorand elsewhere than Base", async () => {
    const { facilitatorsFor } = await import("../src/server/facilitator-router.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const route = facilitatorsFor(loadConfig(base, {}), base as NodeJS.ProcessEnv);
    // Coinbase's facilitator indexes the big catalog but cannot settle on
    // Algorand at all, so routing by network is what keeps the second chain
    // from being an offer nobody can complete.
    assert.match(route("eip155:8453").baseUrl, /cdp\.coinbase\.com/);
    assert.match(route(ALGORAND_MAINNET).baseUrl, /goplausible/);
  });

  it("does not build a second client when one facilitator serves both", async () => {
    const { facilitatorsFor } = await import("../src/server/facilitator-router.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const cfg = loadConfig({ ...base, X402_FACILITATOR_URL: "https://facilitator.goplausible.xyz" }, {});
    const route = facilitatorsFor(cfg, base as NodeJS.ProcessEnv);
    assert.equal(route("eip155:8453"), route(ALGORAND_MAINNET), "same client, not a duplicate");
  });
});

describe("choosing the terms the buyer signed for", () => {
  it("matches the offer by network rather than by position", async () => {
    const { selectTerms } = await import("../src/server/x402.ts");
    const accepts = [
      { scheme: "exact", network: "eip155:8453", amount: "10000", asset: "0xusdc", payTo: "0xus", maxTimeoutSeconds: 120 },
      { scheme: "exact", network: ALGORAND_MAINNET, amount: "10000", asset: "31566704", payTo: REAL, maxTimeoutSeconds: 120 },
    ];
    // A buyer who picked the second chain would otherwise be checked against
    // terms they never agreed to, and rejected for a mismatch they did not make.
    const picked = selectTerms(accepts as never, {
      accepted: { scheme: "exact", network: ALGORAND_MAINNET },
    } as never);
    assert.equal(picked!.network, ALGORAND_MAINNET);
    assert.equal(selectTerms(accepts as never, null)!.network, "eip155:8453");
  });
});

describe("every handler picks terms the same way", () => {
  it("no request path selects payment terms by position", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const roots = ["src/server", "src/hosaka/server"];
    const offenders: string[] = [];

    for (const dir of roots) {
      for (const file of readdirSync(new URL(`../${dir}`, import.meta.url))) {
        if (!file.endsWith(".ts")) continue;
        // selectTerms is the one place allowed to fall back to position: with
        // no payload there is no choice to honour, and with an unmatched one a
        // concrete mismatch reason beats a bare failure.
        if (file === "x402.ts") continue;
        const source = readFileSync(new URL(`../${dir}/${file}`, import.meta.url), "utf8");
        if (source.includes("accepts[0]")) offenders.push(`${dir}/${file} (accepts[0])`);
        // Same bug, one layer up: an entry point that builds a single client
        // sends every chain to it, so the second chain's payment is verified
        // by a facilitator that has never heard of it. This is where it hid
        // the third time.
        if (file.includes("entry") && source.includes("new FacilitatorClient(")) {
          offenders.push(`${dir}/${file} (single facilitator)`);
        }
      }
    }

    // There are two independent request paths — deadchannel's probe handler and
    // the shared paid flow Hosaka uses. Fixing one and not the other is exactly
    // what happened: a buyer paying on Algorand was told "network must be
    // eip155:8453", because the handler compared their payment against whichever
    // offer happened to be listed first.
    assert.deepEqual(offenders, [], `these select terms by position: ${offenders.join(", ")}`);
  });
});

describe("the root serves each visitor what it asked for", () => {
  it("gives a browser HTML and an agent JSON, from the same URL", async () => {
    const { createHandler } = await import("../src/hosaka/server/app.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const { createServer } = await import("node:http");

    const cfg = loadConfig(
      { X402_NETWORK: "base", X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a", PUBLIC_URL: "https://example.test" },
      {},
    );
    const server = createServer(createHandler(cfg, (() => {
      throw new Error("no facilitator needed for the root");
    }) as never));
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: "text/html,*/*" } });
      assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      // Vary matters as much as the body: without it a CDN caches the page
      // against the bare URL and then serves it to an agent asking for JSON.
      assert.match(page.headers.get("vary") ?? "", /accept/i);
      const html = await page.text();
      assert.match(html, /Hosaka/, "the page must name the shop");
      assert.match(html, /hosaka-mcp/, "the page must show how an agent connects");

      const card = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: "application/json" } });
      assert.match(card.headers.get("content-type") ?? "", /application\/json/);
      assert.equal(((await card.json()) as { service: string }).service, "Hosaka");
    } finally {
      server.close();
    }
  });
});

describe("the free preview", () => {
  it("gives the shape of the answer and none of the evidence", async () => {
    const { runPreview } = await import("../src/hosaka/server/routes.ts");
    const pv = await runPreview({ domain: "figma.com" });

    // Worth having: a visitor learns something about their own domain.
    assert.ok(pv.vendors > 0, "a real domain should show vendors");
    assert.ok(pv.categories.length > 0);
    assert.ok(pv.sample.length <= 2, "a taste, not the list");

    // Not worth stealing: the proof is what is sold, so it must not appear
    // anywhere in the free response, under any key.
    const dumped = JSON.stringify(pv);
    assert.ok(!/evidence/i.test(dumped), "evidence must stay behind the paywall");
    assert.ok(!/domain-verification|include:/i.test(dumped), "no raw records");
  });
});

describe("the well-known manifest a marketplace crawls", () => {
  it("lists every shelf at its own price, on every chain", async () => {
    const { createHandler } = await import("../src/hosaka/server/app.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const { createServer } = await import("node:http");

    const cfg = loadConfig(
      {
        X402_NETWORK: "base",
        X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
        X402_ALGORAND_PAY_TO: REAL,
        PUBLIC_URL: "https://example.test",
      },
      {},
    );
    const server = createServer(createHandler(cfg, (() => {
      throw new Error("no facilitator needed");
    }) as never));
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/.well-known/x402`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        resources: { resource: { url: string }; accepts: { amount: string; network: string }[] }[];
      };

      const byPath = new Map(body.resources.map((r) => [new URL(r.resource.url).pathname, r]));
      // The prices differ per shelf. A manifest built by overriding priceUsd
      // without priceAtomic would advertise all four at the base price, and a
      // crawler would publish those numbers as ours.
      assert.equal(byPath.get("/lookup")!.accepts[0]!.amount, "10000");
      assert.equal(byPath.get("/dossier")!.accepts[0]!.amount, "70000");
      assert.equal(byPath.get("/people")!.accepts[0]!.amount, "250000");

      for (const [path, entry] of byPath) {
        const nets = entry.accepts.map((a) => a.network);
        assert.ok(nets.some((n) => n.startsWith("algorand:")), `${path} must offer Algorand`);
        assert.ok(nets.includes("eip155:8453"), `${path} must offer Base`);
      }
    } finally {
      server.close();
    }
  });
});

describe("the extra EVM rails", () => {
  const base = {
    X402_NETWORK: "base",
    X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
    PUBLIC_URL: "https://example.test",
  };
  const route = {
    path: "/lookup",
    method: "POST" as const,
    serviceName: "Test",
    description: "d",
    tags: ["t"],
    mimeType: "application/json",
    inputExample: {},
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
    outputExample: {},
  };

  it("signs each chain against the domain that chain reports", async () => {
    const { loadConfig } = await import("../src/server/config.ts");
    const { buildPaymentRequired } = await import("../src/server/x402.ts");

    const cfg = loadConfig({ ...base, X402_RAILS: "polygon,monad,robinhood" }, {});
    const by = new Map(buildPaymentRequired(cfg, route, "x").accepts.map((a) => [a.network, a]));

    // These differ, and a buyer signs against them. "USD Coin" on Monad or
    // USDC's address on Robinhood produces a signature rejected on every call,
    // with nothing in the response naming the cause.
    assert.deepEqual(by.get("eip155:137")!.extra, { name: "USD Coin", version: "2" });
    assert.deepEqual(by.get("eip155:143")!.extra, { name: "USDC", version: "2" });
    assert.deepEqual(by.get("eip155:4663")!.extra, { name: "Global Dollar", version: "1" });
    assert.equal(by.get("eip155:4663")!.asset, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

    // One key controls an EVM address on every EVM chain.
    for (const a of by.values()) assert.equal(a.payTo, base.X402_PAY_TO);
  });

  it("sends each rail to the facilitator that settles it", async () => {
    const { facilitatorsFor } = await import("../src/server/facilitator-router.ts");
    const { loadConfig } = await import("../src/server/config.ts");

    const env = { ...base, X402_RAILS: "polygon,monad", SOLVADOR_API_KEY: "k" };
    const route2 = facilitatorsFor(loadConfig(env, {}), env as NodeJS.ProcessEnv);
    // Coinbase settles Polygon, so it costs no second credential. It does not
    // settle Monad at all.
    assert.doesNotMatch(route2("eip155:137").baseUrl, /solvador/);
    assert.match(route2("eip155:143").baseUrl, /solvador/);
  });

  it("refuses a Solvador rail without its key, before a buyer signs", async () => {
    const { facilitatorsFor } = await import("../src/server/facilitator-router.ts");
    const { loadConfig } = await import("../src/server/config.ts");

    const env = { ...base, X402_RAILS: "monad" };
    const client = facilitatorsFor(loadConfig(env, {}), env as NodeJS.ProcessEnv)("eip155:143");
    assert.throws(() => client.authFor("POST", "https://api.solvador.com/verify"), /SOLVADOR_API_KEY/);
  });

  it("ignores unknown rail names instead of inventing chains", async () => {
    const { parseRails } = await import("../src/server/rails.ts");
    assert.deepEqual(parseRails("polygon, nonsense ,,MONAD").map((r) => r.caip2), ["eip155:137", "eip155:143"]);
    assert.deepEqual(parseRails(undefined), []);
  });
});
