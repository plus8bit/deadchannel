import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, it } from "node:test";
import { CdpAuthError, createCdpBearer, readCdpCredentials } from "../src/server/cdp-auth.ts";
import { facilitatorAuth, isCdp } from "../src/server/facilitator-auth.ts";
import { loadConfig } from "../src/server/config.ts";

/** Build a credential in exactly the shape CDP hands out: seed ++ public key. */
function makeCredentials() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    keyId: "11111111-2222-3333-4444-555555555555",
    keySecret: Buffer.concat([seed, raw]).toString("base64"),
    publicKey,
  };
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("CDP bearer tokens", () => {
  const { keyId, keySecret, publicKey } = makeCredentials();
  const credentials = { keyId, keySecret };
  const URL_ = "https://api.cdp.coinbase.com/platform/v2/x402/settle";

  it("produces a signature CDP's public key can verify", () => {
    const token = createCdpBearer(credentials, "POST", URL_);
    const [header, claims, signature] = token.split(".") as [string, string, string];
    const ok = verify(
      null,
      Buffer.from(`${header}.${claims}`, "utf8"),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
    assert.equal(ok, true, "a token CDP cannot verify means every payment fails");
  });

  it("uses EdDSA and carries the key id in the header", () => {
    const [header] = createCdpBearer(credentials, "POST", URL_).split(".") as [string];
    const h = decode(header);
    assert.equal(h["alg"], "EdDSA");
    assert.equal(h["typ"], "JWT");
    assert.equal(h["kid"], keyId);
    assert.match(String(h["nonce"]), /^[0-9a-f]{16}$/);
  });

  it("binds the token to the exact method, host and path", () => {
    const [, claims] = createCdpBearer(credentials, "post", URL_).split(".") as [string, string];
    const c = decode(claims);
    assert.equal(c["uri"], "POST api.cdp.coinbase.com/platform/v2/x402/settle");
    assert.equal(c["iss"], "cdp");
    assert.equal(c["sub"], keyId);
    assert.deepEqual(c["aud"], ["cdp_service"]);
  });

  it("expires two minutes out, not never", () => {
    const now = 1_800_000_000;
    const [, claims] = createCdpBearer(credentials, "POST", URL_, now).split(".") as [string, string];
    const c = decode(claims);
    assert.equal(c["nbf"], now);
    assert.equal(c["exp"], now + 120);
  });

  it("gives a different token per endpoint, so one cannot be replayed at another", () => {
    const verifyToken = createCdpBearer(credentials, "POST", "https://api.cdp.coinbase.com/platform/v2/x402/verify");
    const settleToken = createCdpBearer(credentials, "POST", URL_);
    assert.notEqual(verifyToken, settleToken);
  });

  it("rejects a secret of the wrong length instead of signing garbage", () => {
    assert.throws(
      () => createCdpBearer({ keyId, keySecret: Buffer.alloc(16).toString("base64") }, "POST", URL_),
      CdpAuthError,
    );
  });
});

describe("facilitator auth selection", () => {
  const base = { X402_PAY_TO: "0x712c78928080Adb009E31315c0c3c7473dA9648a", X402_NETWORK: "base" };

  it("recognizes the CDP host", () => {
    assert.equal(isCdp("https://api.cdp.coinbase.com/platform/v2/x402"), true);
    assert.equal(isCdp("https://facilitator.goplausible.xyz"), false);
  });

  it("sends nothing to a keyless facilitator", () => {
    const cfg = loadConfig({ ...base, X402_FACILITATOR_URL: "https://facilitator.goplausible.xyz" });
    assert.equal(facilitatorAuth(cfg, {})("POST", "https://facilitator.goplausible.xyz/verify"), null);
  });

  it("refuses to start pointed at CDP with no credentials", () => {
    const cfg = loadConfig({ ...base, X402_FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402" });
    assert.throws(() => facilitatorAuth(cfg, {}), /CDP_API_KEY_ID/);
  });

  it("signs a fresh token per request when CDP is configured", () => {
    const { keyId, keySecret } = makeCredentials();
    const cfg = loadConfig({ ...base, X402_FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402" });
    const auth = facilitatorAuth(cfg, { CDP_API_KEY_ID: keyId, CDP_API_KEY_SECRET: keySecret });
    const header = auth("POST", "https://api.cdp.coinbase.com/platform/v2/x402/verify");
    // CDP authenticates with a bearer token, so this provider returns a string
    // rather than a header record.
    assert.equal(typeof header, "string");
    assert.match(String(header), /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("reads credentials from the environment only when both halves are present", () => {
    assert.equal(readCdpCredentials({ CDP_API_KEY_ID: "x" }), null);
    assert.deepEqual(readCdpCredentials({ CDP_API_KEY_ID: "x", CDP_API_KEY_SECRET: "y" }), {
      keyId: "x",
      keySecret: "y",
    });
  });
});
