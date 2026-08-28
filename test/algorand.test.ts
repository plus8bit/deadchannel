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
      // without priceAtomic would advertise all five at the base price, and a
      // crawler would publish those numbers as ours. Read from the constants
      // rather than written out, so a reprice cannot leave a stale number here
      // while still failing the moment the shelves collapse onto one price.
      const { PRICE_LOOKUP, PRICE_DOSSIER } = await import("../src/hosaka/server/routes.ts");
      const { TIERS } = await import("../src/hosaka/server/bundle.ts");
      const atomic = (usd: number) => String(Math.round(usd * 1e6));
      assert.equal(byPath.get("/lookup")!.accepts[0]!.amount, atomic(PRICE_LOOKUP));
      assert.equal(byPath.get("/dossier")!.accepts[0]!.amount, atomic(PRICE_DOSSIER));
      assert.equal(byPath.get("/people")!.accepts[0]!.amount, atomic(TIERS.people.priceUsd));
      assert.equal(byPath.get("/executives")!.accepts[0]!.amount, atomic(TIERS.executives.priceUsd));
      assert.equal(
        new Set([...byPath.values()].map((e) => e.accepts[0]!.amount)).size,
        byPath.size,
        "every shelf must carry its own price",
      );

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

describe("Solana, the one chain that cannot share the payout address", () => {
  const PAYOUT = "9FDr6dYrxCRZYeaiXB86MqA9fuC3j5nH5u5fSQvD6QWd";

  it("accepts a real Solana address and rejects an EVM one", async () => {
    const { isSolanaAddress } = await import("../src/server/rails.ts");
    assert.ok(isSolanaAddress(PAYOUT));
    assert.equal(isSolanaAddress("0x712c78928080Adb009E31315c0c3c7473dA9648a"), false);
    assert.equal(isSolanaAddress(PAYOUT.slice(0, 20)), false, "a truncated address must not pass");
    assert.equal(isSolanaAddress("0OIl" + PAYOUT.slice(4)), false, "0, O, I and l are not base58");
  });

  it("advertises the fee payer of the facilitator that settles it", async () => {
    const { loadConfig } = await import("../src/server/config.ts");
    const { buildPaymentRequired } = await import("../src/server/x402.ts");
    const { SOLANA_RAIL } = await import("../src/server/rails.ts");
    const { facilitatorsFor } = await import("../src/server/facilitator-router.ts");

    const env = {
      X402_NETWORK: "base",
      X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
      X402_SOLANA_PAY_TO: PAYOUT,
      SOLVADOR_API_KEY: "k",
      PUBLIC_URL: "https://example.test",
    };
    const cfg = loadConfig(env, {});
    const route = {
      path: "/lookup",
      method: "POST" as const,
      serviceName: "T",
      description: "d",
      tags: ["t"],
      mimeType: "application/json",
      inputExample: {},
      inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
      outputExample: {},
    };
    const sol = buildPaymentRequired(cfg, route, "x").accepts.find((a) => a.network.startsWith("solana:"))!;

    assert.equal(sol.payTo, PAYOUT, "an EVM key does not control a Solana account");
    assert.equal(sol.asset, SOLANA_RAIL.asset);
    // Sellers on Solana advertise different fee payers, because the address
    // belongs to whoever settles for them. Advertising one facilitator's
    // sponsor while routing to another is a payment that cannot complete.
    assert.deepEqual(sol.extra, { feePayer: SOLANA_RAIL.feePayer });
    assert.match(facilitatorsFor(cfg, env as NodeJS.ProcessEnv)(sol.network).baseUrl, /solvador/);
  });
});

describe("what the deck will send to the server", () => {
  it("accepts a pasted URL, because that is what people paste", async () => {
    const { parseDomainRequest } = await import("../src/hosaka/server/routes.ts");
    // The server already strips scheme, path and query. The page used to
    // refuse anything containing a slash, so the most natural input — a URL
    // copied from the address bar — was the one thing that did not work.
    for (const input of ["lighter.xyz", "https://lighter.xyz/", "http://x.com/path?q=1", "WWW.Figma.com"]) {
      assert.ok(parseDomainRequest({ domain: input }).domain.length > 0, input);
    }
    assert.equal(parseDomainRequest({ domain: "https://lighter.xyz/" }).domain, "lighter.xyz");
  });
});

describe("the contract a registry reads before an agent calls", () => {
  it("states the same price the 402 will charge", async () => {
    const { createHandler } = await import("../src/hosaka/server/app.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const { createServer } = await import("node:http");

    const cfg = loadConfig(
      { X402_NETWORK: "base", X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a", PUBLIC_URL: "https://example.test" },
      {},
    );
    const server = createServer(createHandler(cfg, (() => {
      throw new Error("no facilitator needed");
    }) as never));
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const spec = (await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json()) as {
        info: Record<string, unknown>;
        paths: Record<string, { post: Record<string, unknown> }>;
      };

      // x402scan requires these by name and resolves discovery by them.
      assert.ok(spec.info["x-guidance"], "agents read this before anything else");
      assert.ok(spec.info["contact"], "contact proves origin ownership");

      for (const [path, ops] of Object.entries(spec.paths)) {
        const info = ops.post["x-payment-info"] as { price: { amount: string }; protocols: unknown[] };
        assert.ok(info, `${path} must declare what it costs`);
        assert.deepEqual(info.protocols, [{ x402: {} }]);
        assert.ok((ops.post["responses"] as Record<string, unknown>)["402"], `${path} must document its 402`);
      }

      // The spec quotes decimal USD and the 402 quotes atomic units. A registry
      // that publishes one number while the endpoint charges another sends
      // agents to fail on their first call.
      const declared = Number(
        (spec.paths["/dossier"]!.post["x-payment-info"] as { price: { amount: string } }).price.amount,
      );
      const res = await fetch(`http://127.0.0.1:${port}/dossier`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "figma.com" }),
      });
      const required = JSON.parse(
        Buffer.from(res.headers.get("payment-required")!, "base64").toString("utf8"),
      ) as { accepts: { amount: string }[] };
      assert.equal(Number(required.accepts[0]!.amount) / 1e6, declared);
    } finally {
      server.close();
    }
  });
});

describe("what the Bazaar indexes", () => {
  it("keeps every description inside the facilitator's limit", async () => {
    const r = await import("../src/hosaka/server/routes.ts");
    const shelves = [r.LOOKUP_ROUTE, r.DOSSIER_ROUTE, r.BUNDLE_ROUTE, r.EXECUTIVES_ROUTE, r.CONTACTS_ROUTE];
    for (const shelf of shelves) {
      // The CDP facilitator rejects verify and settle outright when a
      // description runs past 500 characters, so an overlong one does not
      // merely rank badly — it stops the endpoint from being paid at all.
      assert.ok(
        shelf.description.length <= 500,
        `${shelf.path}: ${shelf.description.length} characters`,
      );
      // Ranking scores metadata on whether it tells an agent when to call.
      assert.ok(shelf.tags.length >= 3, `${shelf.path} needs tags to be found`);
    }
  });
});

describe("how the spec declares what is free", () => {
  it("marks every unpaid route so a registry does not reject it", async () => {
    const { openApiSpec } = await import("../src/server/descriptors.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const cfg = loadConfig(
      { X402_NETWORK: "base", X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a", PUBLIC_URL: "https://example.test" },
      {},
    );
    const spec = openApiSpec(cfg) as { paths: Record<string, Record<string, Record<string, unknown>>> };

    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const op of Object.values(ops)) {
        const paid = "x-payment-info" in op;
        // A registry probes each path expecting a challenge and reads a plain
        // 200 as a paywall that failed to run, so a free route has to say so.
        // Every route is therefore one or the other, never neither.
        assert.ok(
          paid || Array.isArray(op["security"]),
          `${path} neither charges nor declares itself free`,
        );
      }
    }
  });
});

describe("the record a sale leaves behind", () => {
  it("gives every shelf a way to say what was bought", async () => {
    const { createHandler } = await import("../src/hosaka/server/app.ts");
    // Read the shelf table the handler is built from, by the only route the
    // module exposes: the manifest lists one entry per shelf.
    const { loadConfig } = await import("../src/server/config.ts");
    const { createServer } = await import("node:http");
    const cfg = loadConfig(
      { X402_NETWORK: "base", X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a", PUBLIC_URL: "https://example.test" },
      {},
    );
    const server = createServer(createHandler(cfg, (() => {
      throw new Error("no facilitator needed");
    }) as never));
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const spec = (await (await fetch(`http://127.0.0.1:${port}/openapi.json`)).json()) as {
        paths: Record<string, unknown>;
      };
      const source = await import("node:fs").then((fs) =>
        fs.readFileSync(new URL("../src/hosaka/server/app.ts", import.meta.url), "utf8"),
      );
      // We made a real sale and could not say what it was for. Which questions
      // get paid for is the only demand signal a shop this small has, so a new
      // shelf that forgets to pass `subject` should fail here rather than throw
      // that signal away quietly for weeks.
      const declared = source.match(/subject\b/g)?.length ?? 0;
      assert.ok(
        declared >= Object.keys(spec.paths).length,
        `${Object.keys(spec.paths).length} shelves but only ${declared} mentions of subject`,
      );
    } finally {
      server.close();
    }
  });
});

describe("the health check both shops answer with", () => {
  it("covers every chain the shop advertises, not just the first", async () => {
    const { readFileSync } = await import("node:fs");
    // Both servers must build their chain list the same way, from what the
    // config actually offers. A shop that advertises three rails and checks one
    // reports itself healthy until a buyer discovers otherwise, which is how
    // the Solana rail sat broken while /facilitator said everything was fine.
    for (const file of ["../src/server/app.ts", "../src/hosaka/server/app.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const block = source.slice(source.indexOf("const networks = ["));
      const list = block.slice(0, block.indexOf("];"));
      for (const rail of ["algorandPayTo", "cfg.rails", "solanaPayTo"]) {
        assert.ok(list.includes(rail), `${file}: the health check ignores ${rail}`);
      }
    }
  });
});

describe("where the probe's price actually comes from", () => {
  it("keeps the deployed config and the code default saying the same number", async () => {
    const { DEFAULT_PRICE_USD } = await import("../src/server/config.ts");
    const { readFileSync } = await import("node:fs");
    const file = JSON.parse(
      readFileSync(new URL("../deadchannel.config.json", import.meta.url), "utf8"),
    ) as { priceUsd?: number };

    // The price is stated twice: once in the config the deployment reads, once
    // as the fallback in code. Raising only the fallback changed nothing and
    // still shipped a commit saying the price had gone up, which is worse than
    // leaving it alone. Whichever a reader looks at now has to be the truth.
    assert.equal(
      file.priceUsd,
      DEFAULT_PRICE_USD,
      "deadchannel.config.json and DEFAULT_PRICE_USD disagree, so one of them is a lie",
    );
  });
});

describe("prices written in prose, where nothing checks them", () => {
  it("quotes only prices the challenge will actually ask for", async () => {
    const { hosakaOpenApi, hosakaLlmsTxt } = await import("../src/hosaka/server/openapi.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const { PRICE_LOOKUP, PRICE_DOSSIER, LOOKUP_ROUTE, DOSSIER_ROUTE, BUNDLE_ROUTE, EXECUTIVES_ROUTE, CONTACTS_ROUTE } =
      await import("../src/hosaka/server/routes.ts");
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");

    const cfg = loadConfig(
      { X402_NETWORK: "base", X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a", PUBLIC_URL: "https://example.test" },
      {},
    );
    const shelves = [
      { route: LOOKUP_ROUTE, priceUsd: PRICE_LOOKUP },
      { route: DOSSIER_ROUTE, priceUsd: PRICE_DOSSIER },
      { route: BUNDLE_ROUTE, priceUsd: TIERS.people.priceUsd },
      { route: EXECUTIVES_ROUTE, priceUsd: TIERS.executives.priceUsd },
      { route: CONTACTS_ROUTE, priceUsd: TIERS.contacts.priceUsd },
    ];

    // x-guidance is the first thing an agent reads and the last thing anyone
    // checks. Written by hand, it promised $0.01, $0.07, $0.02, $0.25 and $0.30
    // through three repricings while the challenge asked four times more — the
    // exact catalog-versus-challenge mismatch deadchannel sells a check for.
    const ours = new Set(
      shelves.flatMap((s) => {
        const n = s.priceUsd;
        return [`$${n}`, `$${n.toFixed(2)}`, `$${n.toFixed(3)}`, `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`];
      }),
    );
    for (const [surface, text] of [
      ["openapi", JSON.stringify(hosakaOpenApi(cfg, shelves))],
      ["llms.txt", hosakaLlmsTxt(cfg, shelves)],
    ] as const) {
      const quoted = [...new Set(text.match(/\$\d+\.\d+/g) ?? [])].filter((p) => !ours.has(p));
      assert.deepEqual(quoted, [], `${surface} promises prices we do not charge: ${quoted.join(", ")}`);
    }
  });

  it("serves every discovery surface it tells crawlers about", async () => {
    const { createHandler } = await import("../src/hosaka/server/app.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const { createServer } = await import("node:http");
    const cfg = loadConfig(
      { X402_NETWORK: "base", X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a", PUBLIC_URL: "https://example.test" },
      {},
    );
    const server = createServer(createHandler(cfg, (() => {
      throw new Error("no facilitator needed");
    }) as never));
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      // /llms.txt was advertised on the merchant card and answered 404 here for
      // its whole life. A discovery surface that 404s is worse than one that was
      // never claimed, because a crawler records the failure and moves on.
      for (const path of ["/llms.txt", "/openapi.json", "/health", "/favicon.svg"]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        assert.equal(res.status, 200, `${path} answered ${res.status}`);
      }
    } finally {
      server.close();
    }
  });
});

describe("what a buyer can know before paying", () => {
  it("declares an output shape on every paid route", async () => {
    const { hosakaOpenApi } = await import("../src/hosaka/server/openapi.ts");
    const { loadConfig } = await import("../src/server/config.ts");
    const { PRICE_LOOKUP, PRICE_DOSSIER, LOOKUP_ROUTE, DOSSIER_ROUTE, BUNDLE_ROUTE, EXECUTIVES_ROUTE, CONTACTS_ROUTE } =
      await import("../src/hosaka/server/routes.ts");
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    const cfg = loadConfig(
      { X402_NETWORK: "base", X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a", PUBLIC_URL: "https://example.test" },
      {},
    );
    const spec = hosakaOpenApi(cfg, [
      { route: LOOKUP_ROUTE, priceUsd: PRICE_LOOKUP },
      { route: DOSSIER_ROUTE, priceUsd: PRICE_DOSSIER },
      { route: BUNDLE_ROUTE, priceUsd: TIERS.people.priceUsd },
      { route: EXECUTIVES_ROUTE, priceUsd: TIERS.executives.priceUsd },
      { route: CONTACTS_ROUTE, priceUsd: TIERS.contacts.priceUsd },
    ]) as { paths: Record<string, { post: Record<string, unknown> }> };

    // AgentCash rejects a listing whose bazaar extension declares only its
    // input, and it is right to: without an output shape an agent cannot know
    // what it is buying until it has already paid. Five of ours failed this.
    for (const [path, ops] of Object.entries(spec.paths)) {
      const bazaar = (ops.post["extensions"] as { bazaar?: { schema?: { properties?: Record<string, unknown> } } })?.bazaar;
      const out = bazaar?.schema?.properties?.["output"] as { properties?: Record<string, unknown> } | undefined;
      assert.ok(out, `${path} declares no output schema`);
      assert.ok(
        Object.keys(out.properties ?? {}).length > 0,
        `${path} declares an output schema with no fields, which tells a buyer nothing`,
      );
    }
  });
});
