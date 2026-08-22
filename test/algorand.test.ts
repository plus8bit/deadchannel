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
