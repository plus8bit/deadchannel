import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadConfig, toAtomic } from "../src/server/config.ts";

const GOOD = {
  X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
  X402_NETWORK: "base-sepolia",
  X402_PRICE_USD: "0.001",
  PORT: "8402",
};

describe("toAtomic", () => {
  it("converts without floating-point drift", () => {
    assert.equal(toAtomic(0.001, 6), "1000");
    assert.equal(toAtomic(0.01, 6), "10000");
    assert.equal(toAtomic(1, 6), "1000000");
    assert.equal(toAtomic(0.0001, 6), "100");
    assert.equal(toAtomic(1.23, 6), "1230000");
  });

  it("survives the values that break naive multiplication", () => {
    // 0.29 * 1e6 is 289999.99999999994 in IEEE-754.
    assert.equal(toAtomic(0.29, 6), "290000");
    assert.equal(toAtomic(0.07, 6), "70000");
  });
});

describe("loadConfig", () => {
  it("accepts a well-formed environment", () => {
    const cfg = loadConfig(GOOD);
    assert.equal(cfg.payTo, GOOD.X402_PAY_TO);
    assert.equal(cfg.network.caip2, "eip155:84532");
    assert.equal(cfg.priceAtomic, "1000");
    assert.equal(cfg.network.testnet, true);
  });

  it("picks Base mainnet and its USDC when asked", () => {
    const cfg = loadConfig({ ...GOOD, X402_NETWORK: "base" });
    assert.equal(cfg.network.caip2, "eip155:8453");
    assert.equal(cfg.network.usdc, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    assert.equal(cfg.network.testnet, false);
  });

  it("refuses to start without a payout address", () => {
    assert.throws(() => loadConfig({ ...GOOD, X402_PAY_TO: "" }), ConfigError);
  });

  it("refuses a malformed payout address", () => {
    assert.throws(() => loadConfig({ ...GOOD, X402_PAY_TO: "0xnope" }), ConfigError);
  });

  it("refuses the zero address so payments cannot be burned", () => {
    assert.throws(
      () => loadConfig({ ...GOOD, X402_PAY_TO: "0x0000000000000000000000000000000000000000" }),
      ConfigError,
    );
  });

  it("refuses a non-positive price", () => {
    assert.throws(() => loadConfig({ ...GOOD, X402_PRICE_USD: "0" }), ConfigError);
    assert.throws(() => loadConfig({ ...GOOD, X402_PRICE_USD: "-1" }), ConfigError);
  });

  it("refuses an unknown network rather than guessing", () => {
    assert.throws(() => loadConfig({ ...GOOD, X402_NETWORK: "dogecoin" }), ConfigError);
  });

  it("strips a trailing slash from the public url", () => {
    const cfg = loadConfig({ ...GOOD, PUBLIC_URL: "https://deadchannel.xyz/" });
    assert.equal(cfg.publicUrl, "https://deadchannel.xyz");
  });
});

describe("committed defaults", () => {
  it("uses the checked-in payout address when the environment is silent", () => {
    const cfg = loadConfig({});
    assert.match(cfg.payTo, /^0x[a-fA-F0-9]{40}$/, "a deployment must never start without a payout address");
    assert.equal(cfg.priceAtomic, "1000");
  });

  it("lets the environment override every committed field", () => {
    const other = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
    const cfg = loadConfig({ X402_PAY_TO: other, X402_NETWORK: "base", X402_PRICE_USD: "0.05" });
    assert.equal(cfg.payTo, other);
    assert.equal(cfg.network.caip2, "eip155:8453");
    assert.equal(cfg.priceAtomic, "50000");
  });

  it("can ignore the file entirely, so a bad commit cannot leak into production", () => {
    assert.throws(() => loadConfig({ X402_IGNORE_CONFIG_FILE: "1" }), ConfigError);
  });

  it("derives the public url from the Vercel deployment host", () => {
    const cfg = loadConfig({ VERCEL_PROJECT_PRODUCTION_URL: "deadchannel.vercel.app" });
    assert.equal(cfg.publicUrl, "https://deadchannel.vercel.app");
  });
});
