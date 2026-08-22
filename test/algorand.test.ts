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
