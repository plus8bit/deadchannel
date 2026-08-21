import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePaymentRequirements } from "../src/probe/parse.ts";

/** Shape emitted by the official x402.org reference endpoint (v2, header-delivered). */
const V2_REFERENCE = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "https://x402.vercel.app/protected", description: "Access to protected content", mimeType: "" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
    {
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      amount: "10000",
      asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      payTo: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5",
      maxTimeoutSeconds: 300,
      extra: { feePayer: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5" },
    },
  ],
};

/** Older v1 shape, still served by a large share of live endpoints. */
const V1_TYPICAL = {
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "2500",
      resource: "https://api.example.com/quote",
      description: "Price quote",
      mimeType: "application/json",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      outputSchema: { type: "object", properties: { price: { type: "number" } } },
      extra: { name: "USDC", version: "2" },
    },
  ],
};

describe("parsePaymentRequirements", () => {
  it("reads the v2 reference payload and prices both options", () => {
    const req = parsePaymentRequirements(V2_REFERENCE);
    assert.ok(req);
    assert.equal(req.x402Version, 2);
    assert.equal(req.accepts.length, 2);
    for (const option of req.accepts) {
      assert.equal(option.amountDecimal, 0.01, "10000 atomic USDC is $0.01");
      assert.equal(option.priceUsd, 0.01);
      assert.equal(option.assetSymbol, "USDC");
    }
  });

  it("normalizes CAIP-2 identifiers and flags both as testnet", () => {
    const req = parsePaymentRequirements(V2_REFERENCE);
    assert.deepEqual(
      req?.accepts.map((o) => o.network),
      ["base-sepolia", "solana-devnet"],
    );
    assert.ok(req?.accepts.every((o) => o.networkTestnet && o.networkKnown));
  });

  it("inherits resource metadata hoisted to the v2 root", () => {
    const req = parsePaymentRequirements(V2_REFERENCE);
    assert.equal(req?.accepts[0]?.resource, "https://x402.vercel.app/protected");
    assert.equal(req?.accepts[0]?.description, "Access to protected content");
  });

  it("reads the v1 shape and its maxAmountRequired field", () => {
    const req = parsePaymentRequirements(V1_TYPICAL);
    assert.equal(req?.accepts[0]?.amountDecimal, 0.0025);
    assert.equal(req?.accepts[0]?.network, "base");
    assert.equal(req?.accepts[0]?.networkTestnet, false);
    assert.equal(req?.accepts[0]?.hasOutputSchema, true);
  });

  it("warns when x402Version is missing rather than rejecting the payload", () => {
    const { x402Version, ...withoutVersion } = V1_TYPICAL;
    void x402Version;
    const req = parsePaymentRequirements(withoutVersion);
    assert.ok(req, "payload must still parse");
    assert.equal(req.x402Version, null);
    assert.ok(req.warnings.some((w) => w.includes("x402Version")));
  });

  it("finds accepts[] nested under a wrapper key and says so", () => {
    const req = parsePaymentRequirements({ data: V1_TYPICAL });
    assert.equal(req?.accepts.length, 1);
    assert.ok(req?.warnings.some((w) => w.includes("nested")));
  });

  it("prices a stablecoin in dollars, and a memecoin not at all", () => {
    const req = parsePaymentRequirements({
      x402Version: 2,
      accepts: [{
        scheme: "exact", network: "solana", amount: "7142857143",
        asset: "F2bnJW1z55UQ9ZqGX5RwYQfvNJrd23n66eyBV5QZpump",
        payTo: "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5",
        extra: { name: "TCX", decimals: 6 },
      }],
    });
    // 7,142 tokens of something is not $7,142, and treating it as dollars turns
    // a cheap endpoint into a price trap.
    assert.equal(req?.accepts[0]?.amountDecimal, 7142.857143);
    assert.equal(req?.accepts[0]?.priceUsd, null, "an unknown token has no USD price");
  });

  it("treats an upto ceiling as a limit, not a charge", () => {
    const req = parsePaymentRequirements({
      x402Version: 2,
      accepts: [{
        scheme: "upto", network: "base", amount: "1000000000",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
        extra: { name: "USDC", version: "2" },
      }],
    });
    assert.equal(req?.accepts[0]?.amountDecimal, 1000);
    assert.equal(req?.accepts[0]?.priceUsd, null, "a $1000 spend limit is not a $1000 price");
  });

  it("refuses to price an asset with unknown decimals", () => {
    const req = parsePaymentRequirements({
      x402Version: 1,
      accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "1000", asset: "0xabc", payTo: "0x1" }],
    });
    assert.equal(req?.accepts[0]?.amountDecimal, null);
    assert.equal(req?.accepts[0]?.assetDecimals, null);
    assert.equal(req?.accepts[0]?.priceUsd, null);
  });

  it("returns null for payloads that are not x402 at all", () => {
    assert.equal(parsePaymentRequirements({ hello: "world" }), null);
    assert.equal(parsePaymentRequirements("nope"), null);
    assert.equal(parsePaymentRequirements(null), null);
  });
});
