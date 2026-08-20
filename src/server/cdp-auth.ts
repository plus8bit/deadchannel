import { createPrivateKey, randomBytes, sign } from "node:crypto";

/**
 * Bearer tokens for the Coinbase Developer Platform facilitator.
 *
 * CDP does not accept a static key. Every request carries a short-lived EdDSA
 * JWT that commits to the exact method, host and path being called, so a token
 * captured from one call cannot be replayed against another endpoint.
 *
 * Implemented on Node's native Ed25519 rather than a JWT library: the whole
 * construction is three base64url segments and one signature, and this keeps
 * the service dependency-free.
 */

const TOKEN_LIFETIME_SECONDS = 120;
/** PKCS#8 prefix for a raw Ed25519 seed, so node:crypto will accept it. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export interface CdpCredentials {
  keyId: string;
  /** Base64 API key secret: 32-byte seed followed by the 32-byte public key. */
  keySecret: string;
}

export class CdpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CdpAuthError";
  }
}

/** Reads credentials from the environment, or null when CDP is not configured. */
export function readCdpCredentials(env: NodeJS.ProcessEnv = process.env): CdpCredentials | null {
  const keyId = env["CDP_API_KEY_ID"];
  const keySecret = env["CDP_API_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

/**
 * Build a bearer token for one request.
 *
 * `url` must be the full request URL: the host and path are bound into the
 * token, and a mismatch is rejected by CDP rather than ignored.
 */
export function createCdpBearer(
  credentials: CdpCredentials,
  method: string,
  url: string,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const parsed = new URL(url);
  const uri = `${method.toUpperCase()} ${parsed.host}${parsed.pathname}`;

  const header = {
    alg: "EdDSA",
    typ: "JWT",
    kid: credentials.keyId,
    nonce: randomBytes(8).toString("hex"),
  };

  const claims = {
    iss: "cdp",
    sub: credentials.keyId,
    aud: ["cdp_service"],
    nbf: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    uri,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign(null, Buffer.from(signingInput, "utf8"), privateKeyFrom(credentials.keySecret));

  return `${signingInput}.${signature.toString("base64url")}`;
}

function privateKeyFrom(keySecret: string) {
  let raw: Buffer;
  try {
    raw = Buffer.from(keySecret, "base64");
  } catch {
    throw new CdpAuthError("CDP_API_KEY_SECRET is not valid base64");
  }
  // CDP ships seed+public concatenated; older keys are the bare 32-byte seed.
  if (raw.length !== 64 && raw.length !== 32) {
    throw new CdpAuthError(
      `CDP_API_KEY_SECRET decodes to ${raw.length} bytes, expected 32 or 64. ` +
        "Copy the Ed25519 secret exactly as the CDP portal shows it.",
    );
  }
  const seed = raw.subarray(0, 32);
  try {
    return createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
      format: "der",
      type: "pkcs8",
    });
  } catch (err) {
    throw new CdpAuthError(`CDP_API_KEY_SECRET is not a usable Ed25519 key: ${String(err)}`);
  }
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
