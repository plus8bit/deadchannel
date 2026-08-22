// src/server/app.ts
import { createServer } from "node:http";

// deadchannel.config.json
var deadchannel_config_default = {
  $comment: "Public deployment settings. Environment variables override every field. The payout address is public information by design: an x402 seller never holds a private key, it only declares where settlement should land. Publishing it here rather than hiding it in a dashboard means anyone can audit where the money goes.",
  payTo: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
  network: "base",
  priceUsd: 1e-3,
  publicUrl: "https://deadchannel.vercel.app",
  facilitatorUrl: "https://facilitator.goplausible.xyz"
};

// src/server/algorand.ts
import { createHash } from "node:crypto";
var ALGORAND_MAINNET = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
var ALGORAND_TESTNET = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
var USDC_ASA_MAINNET = "31566704";
var USDC_ASA_TESTNET = "10458941";
var GOPLAUSIBLE_FEE_PAYER = "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA";
var CHALLENGE_TAG = "x402-global-challenge";
var BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(s) {
  const out = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) return null;
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push(value >> bits & 255);
    }
  }
  return new Uint8Array(out);
}
function isAlgorandAddress(value) {
  if (!/^[A-Z2-7]{58}$/.test(value)) return false;
  const raw = decodeBase32(value);
  if (raw === null || raw.length < 36) return false;
  const pubkey = raw.subarray(0, 32);
  const checksum = raw.subarray(32, 36);
  const expected = createHash("sha512-256").update(pubkey).digest().subarray(28, 32);
  return Buffer.compare(Buffer.from(checksum), expected) === 0;
}
function algorandOption(offer, priceAtomic, maxTimeoutSeconds) {
  return {
    scheme: "exact",
    network: offer.testnet ? ALGORAND_TESTNET : ALGORAND_MAINNET,
    amount: priceAtomic,
    asset: offer.testnet ? USDC_ASA_TESTNET : USDC_ASA_MAINNET,
    payTo: offer.payTo,
    maxTimeoutSeconds,
    extra: { tag: CHALLENGE_TAG, feePayer: GOPLAUSIBLE_FEE_PAYER }
  };
}

// src/server/config.ts
var NETWORKS = {
  "base-sepolia": {
    caip2: "eip155:84532",
    label: "Base Sepolia",
    testnet: true,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    usdcName: "USDC",
    usdcVersion: "2"
  },
  base: {
    caip2: "eip155:8453",
    label: "Base",
    testnet: false,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdcName: "USD Coin",
    usdcVersion: "2"
  }
};
var USDC_DECIMALS = 6;
var EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
var FILE_DEFAULTS = deadchannel_config_default;
function loadConfig(env = process.env, defaults = FILE_DEFAULTS) {
  const problems = [];
  const file = env["X402_IGNORE_CONFIG_FILE"] === "1" ? {} : defaults;
  const networkKey = env["X402_NETWORK"] ?? file.network ?? "base-sepolia";
  const network = NETWORKS[networkKey];
  if (!network) {
    problems.push(`X402_NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}, got "${networkKey}"`);
  }
  const payTo = env["X402_PAY_TO"] ?? file.payTo ?? "";
  if (!EVM_ADDRESS.test(payTo)) {
    problems.push(`X402_PAY_TO must be a 0x-prefixed 40-hex-digit address, got "${payTo || "(unset)"}"`);
  }
  if (/^0x0{40}$/i.test(payTo)) {
    problems.push("X402_PAY_TO is the zero address \u2014 payments would be destroyed");
  }
  const priceUsd = Number(env["X402_PRICE_USD"] ?? file.priceUsd ?? 1e-3);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    problems.push(`X402_PRICE_USD must be a positive number, got "${env["X402_PRICE_USD"]}"`);
  }
  const port = Number(env["PORT"] ?? "8402");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be a valid port number, got "${env["PORT"]}"`);
  }
  const algorandPayTo = env["X402_ALGORAND_PAY_TO"] ?? file.algorandPayTo ?? null;
  if (algorandPayTo !== null && !isAlgorandAddress(algorandPayTo)) {
    problems.push(
      `X402_ALGORAND_PAY_TO must be a 58-character Algorand address with a valid checksum, got "${algorandPayTo}"`
    );
  }
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  const net = network;
  const publicUrl = (env["PUBLIC_URL"] ?? file.publicUrl ?? // Vercel injects the deployment host but not the scheme.
  (env["VERCEL_PROJECT_PRODUCTION_URL"] ? `https://${env["VERCEL_PROJECT_PRODUCTION_URL"]}` : null) ?? `http://localhost:${port}`).replace(/\/+$/, "");
  return {
    port,
    publicUrl,
    network: net,
    payTo,
    priceUsd,
    priceAtomic: toAtomic(priceUsd, USDC_DECIMALS),
    facilitatorUrl: (env["X402_FACILITATOR_URL"] ?? file.facilitatorUrl ?? defaultFacilitator(net)).replace(/\/+$/, ""),
    facilitatorToken: env["X402_FACILITATOR_TOKEN"] ?? null,
    maxTimeoutSeconds: Number(env["X402_MAX_TIMEOUT_SECONDS"] ?? "120"),
    algorandPayTo
  };
}
var ConfigError = class extends Error {
  problems;
  constructor(problems) {
    super(`invalid configuration:
  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
};
function defaultFacilitator(net) {
  return net.testnet ? "https://x402.org/facilitator" : "https://facilitator.xpay.sh";
}
function toAtomic(amount, decimals) {
  const [whole = "0", frac = ""] = amount.toFixed(decimals).split(".");
  const padded = frac.padEnd(decimals, "0").slice(0, decimals);
  const atomic = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  return atomic;
}

// src/server/facilitator.ts
var FacilitatorError = class extends Error {
  status;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "FacilitatorError";
    this.status = status;
    this.body = body;
  }
};
function staticToken(token) {
  return () => token ? `Bearer ${token}` : null;
}
var FacilitatorClient = class {
  baseUrl;
  #auth;
  #timeoutMs;
  constructor(baseUrl, auth = null, timeoutMs = 2e4) {
    this.baseUrl = baseUrl;
    this.#auth = typeof auth === "function" ? auth : staticToken(auth);
    this.#timeoutMs = timeoutMs;
  }
  /** Read-only validation. Must run before the resource executes. */
  verify(paymentPayload, paymentRequirements) {
    return this.post("/verify", {
      x402Version: 2,
      paymentPayload,
      paymentRequirements
    });
  }
  /** Commits the payment. Runs after the resource produced a successful result. */
  settle(paymentPayload, paymentRequirements) {
    return this.post("/settle", {
      x402Version: 2,
      paymentPayload,
      paymentRequirements
    });
  }
  /** Used at boot to prove the facilitator can actually settle on our network. */
  async supported() {
    const body = await this.get("/supported");
    return body.kinds ?? [];
  }
  async post(path, body) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }
  async get(path) {
    return this.request(path, { method: "GET" });
  }
  async request(path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const url = `${this.baseUrl}${path}`;
    const authorization = this.#auth(init.method, url);
    try {
      const res = await fetch(url, {
        method: init.method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...init.body ? { "content-type": "application/json" } : {},
          ...authorization ? { authorization } : {}
        },
        ...init.body ? { body: init.body } : {}
      });
      const text = await res.text();
      if (!res.ok) {
        throw new FacilitatorError(
          `facilitator ${init.method} ${path} returned ${res.status}`,
          res.status,
          text.slice(0, 500)
        );
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new FacilitatorError(`facilitator ${path} returned non-JSON`, res.status, text.slice(0, 200));
      }
    } catch (err) {
      if (err instanceof FacilitatorError) throw err;
      const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : String(err);
      throw new FacilitatorError(`facilitator ${init.method} ${path} failed: ${reason}`, null, null);
    } finally {
      clearTimeout(timer);
    }
  }
};

// src/server/cdp-auth.ts
import { createPrivateKey, randomBytes, sign } from "node:crypto";
var TOKEN_LIFETIME_SECONDS = 120;
var PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
var CdpAuthError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CdpAuthError";
  }
};
function readCdpCredentials(env = process.env) {
  const keyId = env["CDP_API_KEY_ID"];
  const keySecret = env["CDP_API_KEY_SECRET"];
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}
function createCdpBearer(credentials, method, url, now = Math.floor(Date.now() / 1e3)) {
  const parsed = new URL(url);
  const uri = `${method.toUpperCase()} ${parsed.host}${parsed.pathname}`;
  const header2 = {
    alg: "EdDSA",
    typ: "JWT",
    kid: credentials.keyId,
    nonce: randomBytes(8).toString("hex")
  };
  const claims = {
    iss: "cdp",
    sub: credentials.keyId,
    aud: ["cdp_service"],
    nbf: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    uri
  };
  const signingInput = `${b64url(JSON.stringify(header2))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign(null, Buffer.from(signingInput, "utf8"), privateKeyFrom(credentials.keySecret));
  return `${signingInput}.${signature.toString("base64url")}`;
}
function privateKeyFrom(keySecret) {
  let raw;
  try {
    raw = Buffer.from(keySecret, "base64");
  } catch {
    throw new CdpAuthError("CDP_API_KEY_SECRET is not valid base64");
  }
  if (raw.length !== 64 && raw.length !== 32) {
    throw new CdpAuthError(
      `CDP_API_KEY_SECRET decodes to ${raw.length} bytes, expected 32 or 64. Copy the Ed25519 secret exactly as the CDP portal shows it.`
    );
  }
  const seed = raw.subarray(0, 32);
  try {
    return createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
      format: "der",
      type: "pkcs8"
    });
  } catch (err) {
    throw new CdpAuthError(`CDP_API_KEY_SECRET is not a usable Ed25519 key: ${String(err)}`);
  }
}
function b64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

// src/server/facilitator-auth.ts
function facilitatorAuth(cfg, env = process.env) {
  if (isCdp(cfg.facilitatorUrl)) {
    const credentials = readCdpCredentials(env);
    if (!credentials) {
      throw new Error(
        "facilitator is CDP but CDP_API_KEY_ID / CDP_API_KEY_SECRET are unset. Create a key at portal.cdp.coinbase.com, or point X402_FACILITATOR_URL at a keyless facilitator."
      );
    }
    return (method, url) => `Bearer ${createCdpBearer(credentials, method, url)}`;
  }
  return staticToken(cfg.facilitatorToken);
}
function isCdp(url) {
  try {
    return new URL(url).host.endsWith("cdp.coinbase.com");
  } catch {
    return false;
  }
}

// src/probe/assets.ts
var REGISTRY = /* @__PURE__ */ new Map([
  // USDC, 6 decimals everywhere
  ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", { symbol: "USDC", decimals: 6, usd: 1 }],
  // Base
  ["0x036cbd53842c5426634e7929541ec2318f3dcf7e", { symbol: "USDC", decimals: 6, usd: 1 }],
  // Base Sepolia
  ["0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", { symbol: "USDC", decimals: 6, usd: 1 }],
  // Polygon
  ["0xaf88d065e77c8cc2239327c5edb3a432268e5831", { symbol: "USDC", decimals: 6, usd: 1 }],
  // Arbitrum
  ["0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", { symbol: "USDC", decimals: 6, usd: 1 }],
  // Avalanche
  ["epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v", { symbol: "USDC", decimals: 6, usd: 1 }],
  // Solana
  ["4zmmc9srt5ri5x14gagxhahii3gnpaeerypjgzjdncdu", { symbol: "USDC", decimals: 6, usd: 1 }],
  // Solana devnet
  // Algorand names an asset by its integer ASA id, not an address. 31566704 is
  // USDC on MainNet; 10458941 is USDC on TestNet.
  ["31566704", { symbol: "USDC", decimals: 6, usd: 1 }],
  ["10458941", { symbol: "USDC", decimals: 6, usd: 1 }]
]);
function resolveAsset(address, extra) {
  const declaredDecimals = readNumber(extra?.["decimals"]);
  const declaredName = readString(extra?.["name"]) ?? readString(extra?.["symbol"]);
  const known = address ? REGISTRY.get(address.toLowerCase()) : void 0;
  if (known) {
    return {
      symbol: known.symbol,
      decimals: declaredDecimals ?? known.decimals,
      usdPerUnit: known.usd
    };
  }
  const looksStable = declaredName ? /^(usdc|usd coin|usdbc|usdt|tether|pyusd|usdg|dai|eurc)$/i.test(declaredName.trim()) : false;
  return {
    symbol: declaredName ?? null,
    decimals: declaredDecimals ?? (looksStable ? 6 : null),
    usdPerUnit: looksStable ? 1 : null
  };
}
function toDecimal(atomic, decimals) {
  if (decimals === null || !/^\d+$/.test(atomic)) return null;
  try {
    const value = BigInt(atomic);
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const frac = value % divisor;
    return Number(whole) + Number(frac) / Number(divisor);
  } catch {
    return null;
  }
}
function readNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}
function readString(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// src/probe/networks.ts
var CAIP2 = {
  "eip155:1": { name: "ethereum", testnet: false },
  "eip155:10": { name: "optimism", testnet: false },
  "eip155:56": { name: "bsc", testnet: false },
  "eip155:137": { name: "polygon", testnet: false },
  "eip155:8453": { name: "base", testnet: false },
  "eip155:84532": { name: "base-sepolia", testnet: true },
  "eip155:42161": { name: "arbitrum", testnet: false },
  "eip155:421614": { name: "arbitrum-sepolia", testnet: true },
  "eip155:43114": { name: "avalanche", testnet: false },
  "eip155:43113": { name: "avalanche-fuji", testnet: true },
  "eip155:1329": { name: "sei", testnet: false },
  "eip155:1328": { name: "sei-testnet", testnet: true },
  "eip155:4689": { name: "iotex", testnet: false },
  "eip155:196": { name: "x-layer", testnet: false },
  "eip155:143": { name: "monad", testnet: false },
  "eip155:5000": { name: "mantle", testnet: false },
  "eip155:59144": { name: "linea", testnet: false },
  "eip155:100": { name: "gnosis", testnet: false },
  "eip155:2020": { name: "ronin", testnet: false },
  // CAIP-2 identifies a Solana cluster by the first 32 chars of its genesis hash.
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { name: "solana", testnet: false },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { name: "solana-devnet", testnet: true },
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": { name: "solana-testnet", testnet: true },
  // Algorand identifies a network by the base64 genesis hash. CAIP-2 caps a
  // reference at 32 characters, so the spec-shaped id is the hash truncated —
  // but the facilitator actually serving Algorand sends the full 44-character
  // hash, padding included. Both forms appear in the wild and both must
  // resolve; matching only the spec-shaped one left every Algorand endpoint
  // reading as an unknown network, which is 1126 of them.
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k": { name: "algorand", testnet: false },
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=": { name: "algorand", testnet: false },
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe": { name: "algorand-testnet", testnet: true },
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=": { name: "algorand-testnet", testnet: true }
};
var CAIP2_LOWER = Object.fromEntries(
  Object.entries(CAIP2).map(([k, v]) => [k.toLowerCase(), v])
);
var FRIENDLY = /* @__PURE__ */ new Set([
  "ethereum",
  "optimism",
  "bsc",
  "polygon",
  "base",
  "base-sepolia",
  "arbitrum",
  "arbitrum-sepolia",
  "avalanche",
  "avalanche-fuji",
  "sei",
  "sei-testnet",
  "iotex",
  "solana",
  "solana-devnet",
  "solana-testnet",
  "algorand",
  "algorand-testnet"
]);
var TESTNET_PATTERN = /sepolia|devnet|testnet|fuji|goerli|holesky/i;
function normalizeNetwork(raw) {
  if (!raw) return { name: "unknown", testnet: false, known: false };
  const id = raw.trim();
  const caip = CAIP2[id] ?? CAIP2_LOWER[id.toLowerCase()];
  if (caip) return { name: caip.name, testnet: caip.testnet, known: true };
  const lower = id.toLowerCase();
  if (FRIENDLY.has(lower)) {
    return { name: lower, testnet: TESTNET_PATTERN.test(lower), known: true };
  }
  if (/^[a-z0-9-]{3,8}:[a-zA-Z0-9]{1,32}$/.test(id)) {
    return { name: id, testnet: TESTNET_PATTERN.test(id), known: false };
  }
  return { name: lower, testnet: TESTNET_PATTERN.test(lower), known: false };
}
function addressFamily(name) {
  if (name.startsWith("solana")) return "solana";
  if (name.startsWith("algorand")) return "algorand";
  if (name.startsWith("eip155:")) return "evm";
  if (FRIENDLY.has(name) || CAIP2[name]) return "evm";
  return "unknown";
}

// src/probe/parse.ts
function parsePaymentRequirements(body) {
  const warnings = [];
  const root = asRecord(body);
  if (!root) return null;
  let scope = root;
  if (!Array.isArray(root["accepts"])) {
    for (const key of ["data", "x402", "payment", "paymentRequirements"]) {
      const nested = asRecord(root[key]);
      if (nested && Array.isArray(nested["accepts"])) {
        scope = nested;
        warnings.push(`accepts[] was nested under "${key}" rather than at the top level`);
        break;
      }
    }
  }
  const rawAccepts = scope["accepts"];
  if (!Array.isArray(rawAccepts)) return null;
  const version = readInt(scope["x402Version"] ?? root["x402Version"]);
  if (version === null) {
    warnings.push("no x402Version field \u2014 all reference implementations send one");
  }
  const rootResource = asRecord(scope["resource"]);
  const bazaarExt = asRecord(scope["extensions"]);
  const accepts = [];
  for (const [i, entry] of rawAccepts.entries()) {
    const option = parseOption(entry, i, warnings, rootResource, bazaarExt);
    if (option) accepts.push(option);
  }
  return { x402Version: version, accepts, bazaar: parseBazaar(scope, rawAccepts), warnings };
}
function parseOption(entry, index, warnings, rootResource, bazaarExt) {
  const o = asRecord(entry);
  if (!o) {
    warnings.push(`accepts[${index}] is not an object`);
    return null;
  }
  const amount = readString2(o["maxAmountRequired"]) ?? readString2(o["amount"]) ?? readString2(o["maxAmount"]);
  if (amount === null) {
    warnings.push(`accepts[${index}] has no maxAmountRequired`);
  }
  const asset = readString2(o["asset"]);
  const extra = asRecord(o["extra"]);
  const resolved = resolveAsset(asset, extra);
  const atomic = amount ?? "0";
  const bazaarInfo = asRecord(asRecord(bazaarExt?.["bazaar"])?.["info"]);
  const outputSchema = o["outputSchema"] ?? rootResource?.["outputSchema"] ?? bazaarInfo?.["output"];
  const inputSchema = o["inputSchema"] ?? rootResource?.["inputSchema"] ?? bazaarInfo?.["input"] ?? asRecord(outputSchema)?.["input"];
  const net = normalizeNetwork(readString2(o["network"]));
  const scheme = readString2(o["scheme"]) ?? "unknown";
  return {
    scheme,
    network: net.name,
    networkRaw: readString2(o["network"]) ?? "unknown",
    networkKnown: net.known,
    networkTestnet: net.testnet,
    maxAmountRequired: atomic,
    amountDecimal: toDecimal(atomic, resolved.decimals),
    priceUsd: priceInUsd(scheme, atomic, resolved),
    asset,
    assetSymbol: resolved.symbol,
    assetDecimals: resolved.decimals,
    payTo: readString2(o["payTo"]),
    extra: asRecord(o["extra"]),
    resource: readString2(o["resource"]) ?? readString2(rootResource?.["url"]),
    description: readString2(o["description"]) ?? readString2(rootResource?.["description"]),
    mimeType: readString2(o["mimeType"]) ?? readString2(rootResource?.["mimeType"]),
    maxTimeoutSeconds: readInt(o["maxTimeoutSeconds"]),
    hasOutputSchema: isMeaningful(outputSchema),
    hasInputSchema: isMeaningful(inputSchema)
  };
}
function parseBazaar(scope, accepts) {
  const candidates = [];
  const resource = asRecord(scope["resource"]);
  if (resource) candidates.push(resource);
  const rootExt = asRecord(scope["extensions"]) ?? asRecord(scope["bazaar"]);
  if (rootExt) {
    candidates.push(rootExt);
    const bazaar = asRecord(rootExt["bazaar"]);
    if (bazaar) candidates.push(bazaar);
  }
  candidates.push(scope);
  for (const entry of accepts) {
    const o = asRecord(entry);
    if (o) {
      const ext = asRecord(o["extensions"]) ?? asRecord(o["bazaar"]);
      if (ext) candidates.push(ext);
      candidates.push(o);
    }
  }
  let serviceName = null;
  let iconUrl = null;
  const tags = [];
  for (const c of candidates) {
    serviceName ??= readString2(c["serviceName"]) ?? readString2(c["name"]);
    iconUrl ??= readString2(c["iconUrl"]);
    const rawTags = c["tags"];
    if (Array.isArray(rawTags)) {
      for (const t of rawTags) {
        const s = readString2(t);
        if (s && !tags.includes(s)) tags.push(s);
      }
    }
  }
  return { serviceName, tags, iconUrl };
}
function isMeaningful(v) {
  if (v === null || v === void 0) return false;
  if (typeof v !== "object") return false;
  return Object.keys(v).length > 0;
}
var CEILING_SCHEMES = /* @__PURE__ */ new Set(["upto", "batch-settlement", "aggr_deferred"]);
function priceInUsd(scheme, atomic, resolved) {
  if (CEILING_SCHEMES.has(scheme)) return null;
  if (resolved.usdPerUnit === null) return null;
  const amount = toDecimal(atomic, resolved.decimals);
  return amount === null ? null : amount * resolved.usdPerUnit;
}
function asRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
}
function readString2(v) {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
}
function readInt(v) {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

// src/probe/observe.ts
var AGENT_UA = "deadchannel-probe/0.1 (+https://github.com/deadchannel)";
var BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var MAX_BODY_BYTES = 64 * 1024;
async function observe(url, opts) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const method = (opts.method ?? "GET").toUpperCase();
    const sendsBody = method !== "GET" && method !== "HEAD";
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json, */*",
        "user-agent": opts.userAgent,
        // A correct x402 server answers 402 before it validates the body, so an
        // empty object is enough to reach the paywall without guessing a schema.
        ...sendsBody ? { "content-type": "application/json" } : {}
      },
      ...sendsBody ? { body: "{}" } : {}
    });
    const bodyText = await readCapped(res);
    const ms = performance.now() - started;
    let requirements = requirementsFromHeaders(res.headers);
    if (requirements === null && bodyText !== null) {
      try {
        requirements = parsePaymentRequirements(JSON.parse(bodyText));
      } catch {
      }
    }
    return {
      responded: true,
      status: res.status,
      error: null,
      ms,
      bodyText,
      bodyBytes: bodyText === null ? 0 : Buffer.byteLength(bodyText),
      contentType: res.headers.get("content-type"),
      serverHeader: res.headers.get("server"),
      method,
      requirements,
      userAgent: opts.userAgent
    };
  } catch (err) {
    return {
      responded: false,
      status: null,
      error: describeError(err),
      ms: performance.now() - started,
      bodyText: null,
      bodyBytes: 0,
      contentType: null,
      serverHeader: null,
      method: (opts.method ?? "GET").toUpperCase(),
      requirements: null,
      userAgent: opts.userAgent
    };
  } finally {
    clearTimeout(timer);
  }
}
var REQUIREMENT_HEADERS = ["payment-required", "x-payment-required", "x402-payment-required"];
function requirementsFromHeaders(headers) {
  for (const name of REQUIREMENT_HEADERS) {
    const raw = headers.get(name);
    if (!raw) continue;
    const decoded = decodeMaybeBase64(raw);
    if (decoded === null) continue;
    try {
      const parsed = parsePaymentRequirements(JSON.parse(decoded));
      if (parsed) return parsed;
    } catch {
    }
  }
  return null;
}
function decodeMaybeBase64(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    return decoded.trimStart().startsWith("{") ? decoded : null;
  } catch {
    return null;
  }
}
async function readCapped(res) {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } catch {
  } finally {
    void reader.cancel().catch(() => {
    });
  }
  if (chunks.length === 0) return "";
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}
function describeError(err) {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "timed out";
    const cause = err.cause;
    if (cause?.code) return `${err.message} (${cause.code})`;
    return err.message;
  }
  return String(err);
}

// src/probe/checks.ts
var PRICE_FLOOR_USD = 1e-4;
var PRICE_CEILING_USD = 5;
var P99_LATENCY_BUDGET_MS = 5e3;
var EVM_ADDRESS2 = /^0x[a-fA-F0-9]{40}$/;
var SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
var ALGORAND_ADDRESS = /^[A-Z2-7]{58}$/;
var BURN_ADDRESSES = /* @__PURE__ */ new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead"
]);
var BOT_WALL = /just a moment|checking your browser|cf-browser-verification|captcha|attention required|enable javascript and cookies/i;
function runChecks(input) {
  const { agentSamples, browserSample } = input;
  const signals = [];
  const responded = agentSamples.filter((s) => s.responded);
  const withReqs = agentSamples.filter((s) => s.requirements !== null);
  if (responded.length === 0) {
    const why = agentSamples[0]?.error ?? "no response";
    return [
      { id: "reachable", status: "fail", weight: 100, detail: `No HTTP response across ${agentSamples.length} attempts: ${why}.` }
    ];
  }
  if (responded.length < agentSamples.length) {
    const lost = agentSamples.length - responded.length;
    signals.push({
      id: "reachable",
      status: "warn",
      weight: 18,
      detail: `${lost} of ${agentSamples.length} probes got no response \u2014 intermittent availability.`
    });
  } else {
    signals.push({ id: "reachable", status: "pass", weight: 0, detail: `Responded to all ${agentSamples.length} probes.` });
  }
  const agentWalled = responded.some((s) => s.bodyText !== null && BOT_WALL.test(s.bodyText));
  const browserOk = browserSample?.responded === true && browserSample.status === 402;
  if (agentWalled && browserOk) {
    signals.push({
      id: "bot-gate",
      status: "fail",
      weight: 45,
      detail: `Bot wall answers the agent User-Agent but a browser gets a clean 402. Indexers cannot discover this endpoint \u2014 allow non-browser User-Agents, or disable Browser Integrity Check on this route.`
    });
  } else if (agentWalled) {
    signals.push({
      id: "bot-gate",
      status: "fail",
      weight: 40,
      detail: "A bot wall is answering instead of the service. Agents will never reach the payment requirements."
    });
  } else {
    signals.push({ id: "bot-gate", status: "pass", weight: 0, detail: "No bot wall between agents and the endpoint." });
  }
  const statuses = [...new Set(responded.map((s) => s.status))];
  const paid402 = responded.filter((s) => s.status === 402);
  const openOk = responded.filter((s) => s.status !== null && s.status >= 200 && s.status < 300);
  if (withReqs.length === 0) {
    signals.push({
      id: "speaks-402",
      status: "fail",
      weight: 60,
      detail: `No parseable x402 payment requirements. Statuses seen: ${statuses.join(", ") || "none"}.`
    });
  } else if (paid402.length === 0) {
    signals.push({
      id: "speaks-402",
      status: "warn",
      weight: 20,
      detail: `Payment requirements parsed, but no probe returned status 402 (saw ${statuses.join(", ")}).`
    });
  } else if (paid402.length < responded.length) {
    signals.push({
      id: "speaks-402",
      status: "warn",
      weight: 12,
      detail: `Only ${paid402.length} of ${responded.length} probes returned 402 \u2014 inconsistent gating.`
    });
  } else {
    signals.push({ id: "speaks-402", status: "pass", weight: 0, detail: "Returns 402 with parseable payment requirements." });
  }
  if (openOk.length > 0 && withReqs.length > 0) {
    signals.push({
      id: "gate-closed",
      status: "fail",
      weight: 35,
      detail: `${openOk.length} probe(s) got a 2xx with content and no payment. The resource advertises a price it does not enforce \u2014 anyone can take it for free.`
    });
  } else if (openOk.length > 0) {
    signals.push({
      id: "gate-closed",
      status: "skip",
      weight: 0,
      detail: "Endpoint serves content openly and advertises no price. Not an x402 resource."
    });
  } else {
    signals.push({ id: "gate-closed", status: "pass", weight: 0, detail: "Paywall holds \u2014 no unpaid probe received content." });
  }
  const options = withReqs.flatMap((s) => s.requirements?.accepts ?? []);
  if (options.length === 0) return signals;
  signals.push(...priceSignals(options, withReqs));
  signals.push(payToSignal(options));
  signals.push(...networkSignals(options));
  signals.push(schemaSignal(options));
  signals.push(bazaarSignal(withReqs));
  const warnings = [...new Set(withReqs.flatMap((s) => s.requirements?.warnings ?? []))];
  signals.push(
    warnings.length === 0 ? { id: "spec-clean", status: "pass", weight: 0, detail: "Payload matches the documented shape." } : { id: "spec-clean", status: "warn", weight: 4 * warnings.length, detail: `Payload deviates from spec: ${warnings.join("; ")}.` }
  );
  return signals;
}
function priceSignals(options, withReqs) {
  const out = [];
  const priced = options.filter((o) => o.priceUsd !== null);
  if (priced.length === 0) {
    out.push({
      id: "price-sane",
      status: "warn",
      weight: 25,
      detail: `Price in USD cannot be determined. The asset is not a stablecoin we recognize, or the scheme quotes a spending ceiling rather than a charge, so an agent cannot know what this call will actually cost.`
    });
    return out;
  }
  const priceUsd = Math.min(...priced.map((o) => o.priceUsd));
  if (priceUsd <= 0) {
    out.push({ id: "price-sane", status: "warn", weight: 15, detail: "Advertised price is zero. Free endpoints do not need a 402." });
  } else if (priceUsd < PRICE_FLOOR_USD) {
    out.push({
      id: "price-sane",
      status: "warn",
      weight: 12,
      detail: `Price $${fmt(priceUsd)} is below the $${PRICE_FLOOR_USD} floor \u2014 too small to cover settlement, typical of leaderboard-farming stubs.`
    });
  } else if (priceUsd > PRICE_CEILING_USD) {
    out.push({
      id: "price-sane",
      status: "fail",
      weight: 50,
      detail: `Price $${fmt(priceUsd)} exceeds the $${PRICE_CEILING_USD} ceiling. A single call at this price can drain an agent budget \u2014 treat as a price trap unless explicitly allowlisted.`
    });
  } else {
    out.push({ id: "price-sane", status: "pass", weight: 0, detail: `Cheapest option $${fmt(priceUsd)} sits inside the sane band.` });
  }
  const perProbe = withReqs.map((s) => {
    const amounts = (s.requirements?.accepts ?? []).map((o) => o.priceUsd).filter((n) => n !== null);
    return amounts.length > 0 ? Math.min(...amounts) : null;
  }).filter((n) => n !== null);
  const distinct = new Set(perProbe.map((n) => n.toFixed(9)));
  if (perProbe.length > 1 && distinct.size > 1) {
    out.push({
      id: "price-stable",
      status: "fail",
      weight: 40,
      detail: `Quoted price changed across probes taken seconds apart: ${[...distinct].map((d) => `$${fmt(Number(d))}`).join(" \u2192 ")}. Quotes are not stable enough to commit to.`
    });
  } else if (perProbe.length > 1) {
    out.push({ id: "price-stable", status: "pass", weight: 0, detail: "Quote identical across every probe." });
  }
  return out;
}
function payToSignal(options) {
  const withPayTo = options.filter((o) => o.payTo !== null);
  if (withPayTo.length === 0) {
    return { id: "pay-to-valid", status: "fail", weight: 40, detail: "No payTo address declared \u2014 there is nobody to pay." };
  }
  const problems = [];
  const brokered = [];
  for (const o of withPayTo) {
    const addr = o.payTo;
    if (BURN_ADDRESSES.has(addr.toLowerCase())) {
      problems.push(`payTo on ${o.network} is a burn address (${addr}) \u2014 funds sent here are destroyed`);
      continue;
    }
    if (isBrokeredPayout(addr, o.network)) {
      brokered.push(o.network);
      continue;
    }
    if (!addressMatchesNetwork(addr, o.network)) {
      problems.push(`payTo ${truncate(addr)} is not a valid address for network "${o.network}"`);
    }
  }
  if (problems.length > 0) {
    return { id: "pay-to-valid", status: "fail", weight: 45, detail: problems.join("; ") + "." };
  }
  if (brokered.length > 0) {
    return {
      id: "pay-to-valid",
      status: "warn",
      weight: 6,
      detail: `Settlement is brokered via ${[...new Set(brokered)].join(", ")} rather than paid to a chain address. Funds go to the broker, not directly to the operator.`
    };
  }
  return { id: "pay-to-valid", status: "pass", weight: 0, detail: "Every payout address is well formed for its network." };
}
var BROKER_SCHEMES = /^(aws|gcp|azure|stripe):/i;
function isBrokeredPayout(addr, network) {
  return addr.startsWith("urn:") && BROKER_SCHEMES.test(network);
}
function addressMatchesNetwork(addr, network) {
  switch (addressFamily(network)) {
    case "solana":
      return SOLANA_ADDRESS.test(addr);
    case "algorand":
      return ALGORAND_ADDRESS.test(addr);
    case "evm":
      return EVM_ADDRESS2.test(addr);
    default:
      return EVM_ADDRESS2.test(addr) || SOLANA_ADDRESS.test(addr) || ALGORAND_ADDRESS.test(addr);
  }
}
function networkSignals(options) {
  const out = [];
  const networks = [...new Set(options.map((o) => o.network))];
  const unknown = [...new Set(options.filter((o) => !o.networkKnown).map((o) => o.networkRaw))];
  const mainnets = [
    ...new Set(options.filter((o) => !o.networkTestnet && o.network !== "unknown").map((o) => o.network))
  ];
  if (mainnets.length === 0) {
    out.push({
      id: "network-mainnet",
      status: "fail",
      weight: 55,
      detail: `Only testnet networks offered (${networks.join(", ")}). This endpoint cannot accept real value.`
    });
  } else {
    out.push({ id: "network-mainnet", status: "pass", weight: 0, detail: `Settles on mainnet: ${mainnets.join(", ")}.` });
  }
  const brokerRails = unknown.filter((n) => BROKER_SCHEMES.test(n));
  const trulyUnknown = unknown.filter((n) => !BROKER_SCHEMES.test(n));
  if (brokerRails.length > 0) {
    out.push({
      id: "network-broker",
      status: "warn",
      weight: 4,
      detail: `Offers brokered settlement rail(s): ${brokerRails.join(", ")}. Not a public chain \u2014 the broker holds the funds.`
    });
  }
  if (trulyUnknown.length > 0) {
    out.push({
      id: "network-known",
      status: "warn",
      weight: 10,
      detail: `Unrecognized network identifier(s): ${trulyUnknown.join(", ")}. Confirm the chain before sending funds.`
    });
  }
  return out;
}
function schemaSignal(options) {
  const withOutput = options.filter((o) => o.hasOutputSchema).length;
  const withInput = options.filter((o) => o.hasInputSchema).length;
  if (withOutput === 0 && withInput === 0) {
    return {
      id: "schema-advertised",
      status: "warn",
      weight: 15,
      detail: "No input or output schema. An agent has to pay before it can find out what it gets back."
    };
  }
  if (withOutput === 0) {
    return { id: "schema-advertised", status: "warn", weight: 8, detail: "Input schema present, output schema missing \u2014 the response shape is unverifiable before paying." };
  }
  return { id: "schema-advertised", status: "pass", weight: 0, detail: "Call signature and response shape are both published." };
}
function bazaarSignal(withReqs) {
  const meta = withReqs.map((s) => s.requirements?.bazaar).find((b) => b && (b.serviceName || b.tags.length > 0));
  if (!meta) {
    return {
      id: "bazaar-metadata",
      status: "warn",
      weight: 10,
      detail: "No serviceName or tags published. The resource can be indexed but not filtered, so agents searching by topic will not find it."
    };
  }
  const bits = [];
  if (meta.serviceName) bits.push(`name "${meta.serviceName}"`);
  if (meta.tags.length > 0) bits.push(`tags [${meta.tags.join(", ")}]`);
  return { id: "bazaar-metadata", status: "pass", weight: 0, detail: `Discovery metadata published: ${bits.join(", ")}.` };
}
function latencySignal(p99) {
  if (p99 > P99_LATENCY_BUDGET_MS) {
    return {
      id: "latency",
      status: "fail",
      weight: 25,
      detail: `p99 ${Math.round(p99)}ms exceeds the ${P99_LATENCY_BUDGET_MS}ms budget agents typically allow.`
    };
  }
  if (p99 > P99_LATENCY_BUDGET_MS / 2) {
    return { id: "latency", status: "warn", weight: 8, detail: `p99 ${Math.round(p99)}ms is slow but inside budget.` };
  }
  return { id: "latency", status: "pass", weight: 0, detail: `p99 ${Math.round(p99)}ms.` };
}
function fmt(n) {
  if (n === 0) return "0";
  if (n < 0.01) return n.toFixed(6).replace(/0+$/, "");
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
function truncate(s) {
  return s.length > 16 ? `${s.slice(0, 8)}\u2026${s.slice(-6)}` : s;
}

// src/probe/score.ts
var HARM_SIGNALS = /* @__PURE__ */ new Set(["price-sane", "price-stable", "pay-to-valid", "gate-closed"]);
function scoreRisk(signals) {
  const total = signals.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  return Math.min(100, Math.round(total));
}
function decideVerdict(signals, risk) {
  const by = (id) => signals.find((s) => s.id === id);
  const failed = (id) => by(id)?.status === "fail";
  if (failed("reachable")) return "dead";
  if (by("gate-closed")?.status === "skip" && failed("speaks-402")) return "unknown";
  if (failed("speaks-402") || failed("bot-gate")) return "dead";
  const harmful = signals.some((s) => s.status === "fail" && HARM_SIGNALS.has(s.id));
  if (harmful) return "trap";
  if (failed("network-mainnet")) return "testnet";
  if (risk >= 25) return "degraded";
  return "live";
}

// src/probe/probe.ts
var DEFAULTS = { samples: 3, timeoutMs: 1e4, spacingMs: 350, userAgent: AGENT_UA };
async function probe(url, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const target = normalizeUrl(url);
  const method = await resolveMethod(target, cfg);
  const agentSamples = [];
  for (let i = 0; i < cfg.samples; i++) {
    if (i > 0 && cfg.spacingMs > 0) await sleep(cfg.spacingMs);
    agentSamples.push(await observe(target, { timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent, method }));
  }
  let browserSample = null;
  const looksBlocked = agentSamples.some(
    (s) => s.responded && s.status !== null && [403, 429, 503].includes(s.status)
  );
  if (looksBlocked) {
    browserSample = await observe(target, { timeoutMs: cfg.timeoutMs, userAgent: BROWSER_UA, method });
  }
  const signals = runChecks({ agentSamples, browserSample });
  const latency = computeLatency(agentSamples);
  if (latency) signals.push(latencySignal(latency.p99));
  const risk = scoreRisk(signals);
  const requirements = agentSamples.find((s) => s.requirements !== null)?.requirements ?? null;
  const prices = (requirements?.accepts ?? []).map((o) => o.priceUsd).filter((n) => n !== null && n > 0);
  return {
    url: target,
    verdict: decideVerdict(signals, risk),
    risk,
    signals,
    requirements,
    latency,
    priceUsd: prices.length > 0 ? Math.min(...prices) : null,
    probedAt: (/* @__PURE__ */ new Date()).toISOString(),
    samples: agentSamples.length + (browserSample ? 1 : 0)
  };
}
async function resolveMethod(target, cfg) {
  if (cfg.method) return cfg.method.toUpperCase();
  const first = await observe(target, { timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent, method: "GET" });
  const verbRejected = first.status === 405 || first.status === 404 || first.status === 501;
  if (!verbRejected) return "GET";
  const retry = await observe(target, { timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent, method: "POST" });
  return retry.status === 402 || retry.requirements !== null ? "POST" : "GET";
}
function computeLatency(samples) {
  const ms = samples.filter((s) => s.responded).map((s) => Math.round(s.ms)).sort((a, b) => a - b);
  if (ms.length === 0) return null;
  return {
    samples: ms,
    p50: percentile(ms, 0.5),
    p99: percentile(ms, 0.99),
    min: ms[0],
    max: ms[ms.length - 1]
  };
}
function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(q * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}
function normalizeUrl(raw) {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme).toString();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// src/server/routes.ts
var PROBE_ROUTE = {
  path: "/probe",
  method: "POST",
  serviceName: "deadchannel",
  description: "Risk check for any x402 endpoint. Returns a verdict (live, degraded, trap, testnet, dead), a 0-100 risk score and the specific problems found \u2014 before you spend money on it.",
  tags: ["x402", "risk", "security", "discovery", "agent-safety"],
  mimeType: "application/json",
  inputExample: { url: "https://api.example.com/paid-endpoint" },
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The x402 resource URL to check" },
      method: { type: "string", description: "HTTP verb the resource expects, if known" },
      samples: { type: "number", description: "Probes to take, 1-5 (default 2)" }
    },
    required: ["url"]
  },
  outputExample: {
    url: "https://api.example.com/paid-endpoint",
    verdict: "degraded",
    risk: 25,
    priceUsd: 0.01,
    latencyMs: { p50: 180, p99: 240 },
    problems: [
      { id: "schema-advertised", status: "warn", detail: "No input or output schema." }
    ]
  }
};
var BadRequest = class extends Error {
};
var MAX_SAMPLES = 5;
var DEFAULT_SAMPLES = 2;
function parseProbeRequest(body) {
  if (typeof body !== "object" || body === null) {
    throw new BadRequest("body must be a JSON object");
  }
  const raw = body;
  const url = raw["url"];
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new BadRequest("`url` is required and must be a non-empty string");
  }
  const trimmed = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme !== void 0 && scheme !== "http" && scheme !== "https") {
    throw new BadRequest(`\`url\` must be http or https, got "${scheme}:"`);
  }
  let parsed;
  try {
    parsed = new URL(scheme ? trimmed : `https://${trimmed}`);
  } catch {
    throw new BadRequest(`\`url\` is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequest("`url` must be http or https");
  }
  if (!parsed.hostname.includes(".")) {
    throw new BadRequest(`\`url\` must name a public host, got "${parsed.hostname}"`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new BadRequest("`url` must be a public host");
  }
  const method = raw["method"];
  if (method !== void 0 && (typeof method !== "string" || !/^[A-Za-z]{3,7}$/.test(method))) {
    throw new BadRequest("`method` must be an HTTP verb");
  }
  const samples = raw["samples"];
  if (samples !== void 0 && (typeof samples !== "number" || !Number.isInteger(samples) || samples < 1 || samples > MAX_SAMPLES)) {
    throw new BadRequest(`\`samples\` must be an integer from 1 to ${MAX_SAMPLES}`);
  }
  return {
    url: parsed.toString(),
    ...typeof method === "string" ? { method: method.toUpperCase() } : {},
    ...typeof samples === "number" ? { samples } : {}
  };
}
function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254) {
      return true;
    }
  }
  return false;
}
async function runProbe(req) {
  const result = await probe(req.url, {
    samples: req.samples ?? DEFAULT_SAMPLES,
    timeoutMs: 6e3,
    spacingMs: 150,
    ...req.method ? { method: req.method } : {}
  });
  return shape(result);
}
function shape(r) {
  const problems = r.signals.filter((s) => s.status === "fail" || s.status === "warn").sort((a, b) => b.weight - a.weight).map((s) => ({ id: s.id, status: s.status, detail: s.detail }));
  return {
    url: r.url,
    verdict: r.verdict,
    risk: r.risk,
    priceUsd: r.priceUsd,
    networks: [...new Set((r.requirements?.accepts ?? []).map((o) => o.network))],
    latencyMs: r.latency ? { p50: r.latency.p50, p99: r.latency.p99 } : null,
    problems,
    checksPassed: r.signals.filter((s) => s.status === "pass").length,
    checksRun: r.signals.length,
    probedAt: r.probedAt
  };
}

// src/server/descriptors.ts
function llmsTxt(cfg) {
  const url = `${cfg.publicUrl}${PROBE_ROUTE.path}`;
  return `# deadchannel

> Risk check for any x402 endpoint. Returns a verdict, a 0-100 risk score and the
> specific problems found, so an agent can decide whether an endpoint is safe to
> call before it spends money on finding out.

Payment is x402 v2: send the request, get a 402 carrying the price, sign, retry.
No signup and no API key. ${cfg.priceUsd} USD in USDC per call on ${cfg.network.label}.
You are charged only when the check produces a result; a failure settles nothing.

## Endpoint

- [POST ${PROBE_ROUTE.path}](${url}): the check. Body: \`{"url": "<x402 resource to check>", "method": "<optional verb>", "samples": <1-5>}\`

## Verdicts

- \`live\` \u2014 gated, priced sanely, settles on mainnet
- \`degraded\` \u2014 callable, with problems worth weighing
- \`trap\` \u2014 will actively cost the caller money or funds
- \`testnet\` \u2014 works, but cannot accept real value
- \`dead\` \u2014 unreachable, bot-walled, or serving no payment requirements
- \`unknown\` \u2014 reachable, but not an x402 resource

## Free endpoints

- [GET /](${cfg.publicUrl}/): service card as JSON, landing page as HTML
- [GET /health](${cfg.publicUrl}/health): liveness
- [GET /facilitator](${cfg.publicUrl}/facilitator): proves our credentials are accepted, moves no money
- [GET /openapi.json](${cfg.publicUrl}/openapi.json): full schema

## Limits

Every verdict comes from the unpaid 402 an endpoint already returns. We never pay
the endpoints we grade, so we can tell you whether one is safe to try, not whether
its output is any good.

## Source

- [github.com/plus8bit/deadchannel](https://github.com/plus8bit/deadchannel): open source, including the checks and their weights
`;
}
function openApiSpec(cfg) {
  return {
    openapi: "3.1.0",
    info: {
      title: "deadchannel",
      version: "1.0.0",
      description: PROBE_ROUTE.description,
      license: { name: "MIT", identifier: "MIT" }
    },
    servers: [{ url: cfg.publicUrl }],
    paths: {
      [PROBE_ROUTE.path]: {
        post: {
          operationId: "probeEndpoint",
          summary: "Check whether an x402 endpoint is safe to call",
          description: `Paid via x402 v2. An unpaid request returns 402 with a PAYMENT-REQUIRED header carrying the terms: ${cfg.priceUsd} USD in USDC on ${cfg.network.label}. Settlement runs only after the check produces a result.`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: PROBE_ROUTE.inputSchema,
                example: PROBE_ROUTE.inputExample
              }
            }
          },
          responses: {
            "200": {
              description: "The check ran and the payment settled.",
              headers: {
                "PAYMENT-RESPONSE": {
                  description: "Base64 SettlementResponse, including the transaction hash.",
                  schema: { type: "string" }
                }
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Verdict" },
                  example: PROBE_ROUTE.outputExample
                }
              }
            },
            "400": { description: "The request body is not a valid target." },
            "402": {
              description: "Payment required, or the payment was rejected.",
              headers: {
                "PAYMENT-REQUIRED": {
                  description: "Base64 PaymentRequired object carrying price, network and payTo.",
                  schema: { type: "string" }
                }
              }
            },
            "502": { description: "The check failed. Nothing was settled, so you were not charged." }
          }
        }
      },
      "/health": { get: { operationId: "health", summary: "Liveness", responses: { "200": { description: "Alive." } } } },
      "/facilitator": {
        get: {
          operationId: "facilitatorStatus",
          summary: "Whether our facilitator credentials are accepted. Moves no money.",
          responses: { "200": { description: "Ready to settle." }, "503": { description: "Cannot settle." } }
        }
      }
    },
    components: {
      schemas: {
        Verdict: {
          type: "object",
          required: ["url", "verdict", "risk", "problems"],
          properties: {
            url: { type: "string" },
            verdict: {
              type: "string",
              enum: ["live", "degraded", "trap", "testnet", "dead", "unknown"]
            },
            risk: { type: "integer", minimum: 0, maximum: 100, description: "0 is safe to call, 100 is do not call." },
            priceUsd: { type: ["number", "null"] },
            networks: { type: "array", items: { type: "string" } },
            latencyMs: {
              type: ["object", "null"],
              properties: { p50: { type: "integer" }, p99: { type: "integer" } }
            },
            problems: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  status: { type: "string", enum: ["warn", "fail"] },
                  detail: { type: "string" }
                }
              }
            },
            checksPassed: { type: "integer" },
            checksRun: { type: "integer" },
            probedAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    "x-x402": {
      version: 2,
      price: `${cfg.priceUsd} USD`,
      asset: cfg.network.usdc,
      network: cfg.network.caip2,
      payTo: cfg.payTo
    }
  };
}

// src/server/landing.ts
var FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="7" fill="#0C0E13"/>
<path d="M4 20h6l3-11 4 17 3-9h8" fill="none" stroke="#E8873A" stroke-width="2.6"
      stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
function landingPage(cfg) {
  const price = `$${cfg.priceUsd}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>deadchannel</title>
<meta name="description" content="Risk check for any x402 endpoint. Tells an agent whether an endpoint is alive, honestly priced and safe to call, before it spends money.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta name="theme-color" content="#0C0E13">
<meta property="og:title" content="deadchannel">
<meta property="og:description" content="Risk check for any x402 endpoint. Tells an agent whether an endpoint is alive, honestly priced and safe to call, before it spends money.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0C0E13;--surface:#12151B;--line:#1E232C;--ink:#E6EAF0;--dim:#8A93A1;--faint:#5A6270;--amber:#E8873A;--green:#6FAE8F;--steel:#74A6B6}
html{background:var(--bg)}
body{background:var(--bg);color:var(--ink);font:15.5px/1.65 "IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;-webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:56px 24px 96px}
h1{font-family:Archivo,system-ui,sans-serif;font-size:clamp(38px,8vw,62px);font-weight:800;letter-spacing:-.035em;line-height:1}
h1 b{color:var(--amber)}
.tag{color:var(--dim);font-size:15px;margin-top:14px;max-width:62ch}
.status{display:flex;flex-wrap:wrap;gap:10px;margin:30px 0 0}
.pill{border:1px solid var(--line);background:var(--surface);padding:7px 13px;font-size:12.5px;color:var(--dim);letter-spacing:.02em}
.pill i{font-style:normal;color:var(--green)}
.pill s{text-decoration:none;color:var(--amber)}
h2{font-family:Archivo,system-ui,sans-serif;font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin:56px 0 18px}
p{color:var(--dim);max-width:66ch;margin-bottom:14px}
p strong{color:var(--ink);font-weight:600}
pre{background:var(--surface);border:1px solid var(--line);border-left:2px solid var(--amber);padding:16px 18px;overflow-x:auto;font-size:13px;line-height:1.7;color:var(--ink)}
pre .c{color:var(--faint)}
pre .s{color:var(--green)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:6px}
td{padding:9px 12px 9px 0;border-bottom:1px solid var(--line);vertical-align:top;color:var(--dim)}
td:first-child{color:var(--ink);white-space:nowrap;width:1%;padding-right:22px}
.n{color:var(--amber);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin-top:6px}
.cell{background:var(--surface);padding:16px 18px}
.cell b{display:block;font-family:Archivo,sans-serif;font-size:27px;font-weight:800;letter-spacing:-.03em;color:var(--amber);line-height:1}
.cell span{display:block;color:var(--faint);font-size:11.5px;margin-top:8px;letter-spacing:.05em;line-height:1.45}
a{color:var(--amber);text-decoration:none;border-bottom:1px solid #55351a}
a:hover{border-bottom-color:var(--amber)}
a:focus-visible{outline:2px solid var(--amber);outline-offset:3px}
footer{margin-top:64px;padding-top:22px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px;line-height:1.8}
.by{margin-top:18px;padding-top:16px;border-top:1px solid var(--line);color:var(--dim)}
.by span{color:var(--faint)}
@media(max-width:520px){.by span{display:block;margin-top:2px}.by span::before{content:none}}
</style></head><body><div class="wrap">

<h1>dead<b>channel</b></h1>
<p class="tag">Risk check for any x402 endpoint. Tells an agent whether an endpoint is alive, honestly priced and safe to call &mdash; before it spends money on finding out.</p>

<div class="status">
  <span class="pill"><i>&#9679;</i> live on Base mainnet</span>
  <span class="pill">indexed in the <s>Bazaar</s></span>
  <span class="pill">${price} per call, in USDC</span>
  <span class="pill">you pay only on a result</span>
</div>

<h2>Why</h2>
<p>We audited every resource the public Bazaar publishes &mdash; <strong>14,979 of them</strong>. The catalog is healthier than the folklore says, but it is not evenly distributed, and it is largely undescribed.</p>
<div class="grid">
  <div class="cell"><b>18.4%</b><span>OF THE CATALOG BELONGS TO 3 PAYOUT ADDRESSES, TAKING 1 CALL IN 80</span></div>
  <div class="cell"><b>40.9%</b><span>PUBLISH NO DISCOVERY TAGS, SO TOPIC SEARCH NEVER FINDS THEM</span></div>
  <div class="cell"><b>56.8%</b><span>PASS EVERY CHECK WE RUN</span></div>
</div>
<p style="margin-top:16px">An agent picking from that catalog is guessing with real money. This service is the check it can run first.</p>

<h2>Use it</h2>
<pre><span class="c"># any x402 client; the 402 carries the price and terms</span>
curl -X POST <span class="s">${cfg.publicUrl}${PROBE_ROUTE.path}</span> \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"url":"https://api.example.com/paid-endpoint"}'</span></pre>
<p style="margin-top:14px">You get a verdict &mdash; <strong>live</strong>, <strong>degraded</strong>, <strong>trap</strong>, <strong>testnet</strong> or <strong>dead</strong> &mdash; a 0&ndash;100 risk score, and the specific problems found. Settlement happens only after the check produces a result, so a failure on our side costs you nothing.</p>

<h2>What it checks</h2>
<table>
<tr><td>reachable</td><td>answers at all, consistently</td></tr>
<tr><td>bot&#8209;gate</td><td>a bot wall answers agents while browsers get a clean 402, so indexers never see it</td></tr>
<tr><td>speaks&#8209;402</td><td>parseable payment requirements, v1 body and v2 header alike</td></tr>
<tr><td>gate&#8209;closed</td><td>advertises a price it does not enforce</td></tr>
<tr><td>price&#8209;sane</td><td>inside $0.0001&ndash;$5; above the ceiling one call can drain a budget</td></tr>
<tr><td>price&#8209;stable</td><td>the quote does not move between probes seconds apart</td></tr>
<tr><td>pay&#8209;to&#8209;valid</td><td>payout address well formed for its chain, and not a burn address</td></tr>
<tr><td>network</td><td>settles somewhere that holds real value, on a chain you recognize</td></tr>
<tr><td>schema</td><td>you can know the response shape before paying</td></tr>
<tr><td>latency</td><td>p99 inside the budget agents allow</td></tr>
</table>

<h2>Honest notes</h2>
<p>Every verdict comes from the unpaid 402 an endpoint already returns. <strong>We never pay the endpoints we grade</strong>, which is what makes it cheap enough to run across a whole catalog &mdash; and also means we cannot tell you whether a service delivers good output, only whether it is safe to try.</p>
<p>The tool is open source, including the checks and their weights, so you can disagree with a verdict and see exactly why we reached it.</p>

<footer>
  <a href="https://github.com/plus8bit/deadchannel">github.com/plus8bit/deadchannel</a> &middot; <a href="${cfg.publicUrl}/facilitator">facilitator status</a> &middot; settles to <span style="color:var(--dim)">${cfg.payTo.slice(0, 10)}&hellip;${cfg.payTo.slice(-6)}</span> on ${cfg.network.label}<br>
  Machine clients get JSON from this same URL. Ask for <span style="color:var(--dim)">application/json</span>.
  <div class="by">built by <a href="https://x.com/plus8bit">@plus8bit</a><span>&nbsp;&middot;&nbsp;the first customer was a for loop</span></div>
</footer>

</div></body></html>`;
}

// src/server/x402.ts
var HEADER_REQUIRED = "PAYMENT-REQUIRED";
var HEADER_SIGNATURE = "PAYMENT-SIGNATURE";
var HEADER_RESPONSE = "PAYMENT-RESPONSE";
var MAX_SERVICE_NAME = 32;
var MAX_TAGS = 5;
var MAX_TAG_LENGTH = 32;
function buildPaymentRequired(cfg, route, error = "PAYMENT-SIGNATURE header is required") {
  return {
    x402Version: 2,
    error,
    resource: {
      url: `${cfg.publicUrl}${route.path}`,
      description: route.description,
      mimeType: route.mimeType,
      serviceName: clampAscii(route.serviceName, MAX_SERVICE_NAME),
      tags: route.tags.slice(0, MAX_TAGS).map((t) => clampAscii(t, MAX_TAG_LENGTH))
    },
    accepts: [
      {
        scheme: "exact",
        network: cfg.network.caip2,
        amount: cfg.priceAtomic,
        asset: cfg.network.usdc,
        payTo: cfg.payTo,
        maxTimeoutSeconds: cfg.maxTimeoutSeconds,
        extra: { name: cfg.network.usdcName, version: cfg.network.usdcVersion }
      },
      // A second chain is offered, not substituted. A buyer holding USDC on
      // only one of them can still pay, and one that holds both picks for
      // itself; the price is identical either way.
      ...cfg.algorandPayTo ? [algorandOption({ payTo: cfg.algorandPayTo, testnet: cfg.network.testnet }, cfg.priceAtomic, cfg.maxTimeoutSeconds)] : []
    ],
    extensions: bazaarExtension(route)
  };
}
function bazaarExtension(route) {
  return {
    bazaar: {
      info: {
        input: {
          type: "http",
          method: route.method,
          bodyType: "json",
          body: route.inputExample
        },
        output: {
          type: "json",
          example: route.outputExample
        }
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          input: { type: "object", properties: { body: route.inputSchema } },
          output: { type: "object" }
        }
      }
    }
  };
}
function encodeHeader(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}
function decodePaymentSignature(header2) {
  if (!header2) return null;
  const trimmed = header2.trim();
  if (trimmed.length === 0) return null;
  const candidates = trimmed.startsWith("{") ? [trimmed] : [safeBase64(trimmed), trimmed].filter((v) => v !== null);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
    }
  }
  return null;
}
function safeBase64(value) {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return decoded.trimStart().startsWith("{") ? decoded : null;
  } catch {
    return null;
  }
}
function matchesOurTerms(accepted, ours) {
  if (!accepted) return { ok: false, reason: "payment payload has no accepted terms" };
  if (accepted.scheme !== ours.scheme) return { ok: false, reason: `scheme must be ${ours.scheme}` };
  if (accepted.network !== ours.network) return { ok: false, reason: `network must be ${ours.network}` };
  if (accepted.amount !== ours.amount) return { ok: false, reason: `amount must be ${ours.amount}` };
  if (!sameAddress(accepted.asset, ours.asset)) return { ok: false, reason: "asset does not match" };
  if (!sameAddress(accepted.payTo, ours.payTo)) return { ok: false, reason: "payTo does not match" };
  return { ok: true };
}
function sameAddress(a, b) {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}
function clampAscii(value, max) {
  return value.replace(/[^\x20-\x7E]/g, "").slice(0, max);
}

// src/server/app.ts
var MAX_BODY_BYTES2 = 32 * 1024;
var DEFAULT_DEPS = { runProbe };
function createHandler(cfg, facilitator, deps = DEFAULT_DEPS) {
  return (req, res) => {
    handle(req, res, cfg, facilitator, deps).catch((err) => {
      log("error", { msg: "unhandled", err: describe(err) });
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    });
  };
}
function createApp(cfg, facilitator, deps = DEFAULT_DEPS) {
  return createServer(createHandler(cfg, facilitator, deps));
}
async function handle(req, res, cfg, facilitator, deps) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", `content-type, ${HEADER_SIGNATURE}`);
  res.setHeader("access-control-expose-headers", `${HEADER_REQUIRED}, ${HEADER_RESPONSE}`);
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.writeHead(204).end();
    return;
  }
  if (path === "/favicon.svg" || path === "/favicon.ico") return sendSvg(res, FAVICON_SVG);
  if (path === "/health") return send(res, 200, { ok: true, network: cfg.network.label });
  if (path === "/llms.txt") return sendText(res, llmsTxt(cfg));
  if (path === "/openapi.json") return send(res, 200, openApiSpec(cfg));
  if (path === "/facilitator") return handleFacilitatorCheck(res, cfg, facilitator);
  if (path === "/" || path === "/index.json") {
    if (path === "/" && prefersHtml(req)) return sendHtml(res, landingPage(cfg));
    return send(res, 200, serviceCard(cfg));
  }
  if (path === PROBE_ROUTE.path) {
    if (req.method !== PROBE_ROUTE.method) {
      res.setHeader("allow", PROBE_ROUTE.method);
      return send(res, 405, { error: `use ${PROBE_ROUTE.method} ${PROBE_ROUTE.path}` });
    }
    return handlePaidProbe(req, res, cfg, facilitator, deps);
  }
  send(res, 404, {
    error: "not found",
    endpoints: ["GET /", "GET /health", "GET /facilitator", "GET /llms.txt", "GET /openapi.json", "POST /probe"]
  });
}
async function handlePaidProbe(req, res, cfg, facilitator, deps) {
  const required = buildPaymentRequired(cfg, PROBE_ROUTE);
  const ourTerms = required.accepts[0];
  if (!ourTerms) return send(res, 500, { error: "no payment terms configured" });
  const signature = decodePaymentSignature(header(req, HEADER_SIGNATURE));
  if (!signature) {
    res.setHeader(HEADER_REQUIRED, encodeHeader(required));
    return send(res, 402, {
      error: "payment required",
      price: `$${cfg.priceUsd}`,
      network: cfg.network.label,
      hint: `send a signed PaymentPayload in the ${HEADER_SIGNATURE} header`
    });
  }
  let request;
  try {
    request = parseProbeRequest(await readJson(req));
  } catch (err) {
    if (err instanceof BadRequest) return send(res, 400, { error: err.message });
    return send(res, 400, { error: "body must be valid JSON" });
  }
  const terms = matchesOurTerms(signature.accepted, ourTerms);
  if (!terms.ok) {
    res.setHeader(HEADER_REQUIRED, encodeHeader(buildPaymentRequired(cfg, PROBE_ROUTE, terms.reason)));
    return send(res, 402, { error: "payment terms mismatch", reason: terms.reason });
  }
  let verification;
  try {
    verification = await facilitator.verify(signature, ourTerms);
  } catch (err) {
    log("error", { msg: "verify failed", err: describe(err) });
    return send(res, 502, { error: "payment verification unavailable" });
  }
  if (!verification.isValid) {
    res.setHeader(HEADER_REQUIRED, encodeHeader(required));
    return send(res, 402, { error: "payment invalid", reason: verification.invalidReason ?? "unknown" });
  }
  let result;
  try {
    result = await deps.runProbe(request);
  } catch (err) {
    log("error", { msg: "probe failed", url: request.url, err: describe(err) });
    return send(res, 502, { error: "probe failed, you were not charged" });
  }
  let settlement;
  try {
    settlement = await facilitator.settle(signature, ourTerms);
  } catch (err) {
    log("error", { msg: "settle failed", err: describe(err) });
    return send(res, 502, { error: "settlement unavailable, you were not charged" });
  }
  if (!settlement.success) {
    res.setHeader(HEADER_RESPONSE, encodeHeader(settlement));
    return send(res, 402, { error: "settlement failed", reason: settlement.errorReason ?? "unknown" });
  }
  log("info", {
    msg: "sold",
    target: request.url,
    verdict: result.verdict,
    payer: settlement.payer ?? verification.payer,
    tx: settlement.transaction,
    usd: cfg.priceUsd
  });
  res.setHeader(HEADER_RESPONSE, encodeHeader(settlement));
  send(res, 200, result);
}
async function handleFacilitatorCheck(res, cfg, facilitator) {
  const base = {
    facilitator: cfg.facilitatorUrl,
    network: cfg.network.caip2,
    scheme: "exact"
  };
  let kinds;
  try {
    kinds = await facilitator.supported();
  } catch (err) {
    const detail = describe(err);
    const authProblem = err instanceof FacilitatorError && (err.status === 401 || err.status === 403);
    return send(res, 503, {
      ...base,
      reachable: !authProblem,
      authenticated: false,
      canSettle: false,
      problem: authProblem ? "the facilitator rejected our credentials \u2014 check CDP_API_KEY_ID and CDP_API_KEY_SECRET" : detail
    });
  }
  const canSettle = kinds.some((k) => k.network === cfg.network.caip2 && k.scheme === "exact");
  send(res, canSettle ? 200 : 503, {
    ...base,
    reachable: true,
    authenticated: true,
    canSettle,
    supports: kinds.map((k) => `v${k.x402Version}/${k.scheme}/${k.network}`).slice(0, 20),
    ...canSettle ? {} : { problem: `facilitator cannot settle exact on ${cfg.network.caip2}` }
  });
}
function serviceCard(cfg) {
  return {
    service: PROBE_ROUTE.serviceName,
    description: PROBE_ROUTE.description,
    source: "https://github.com/plus8bit/deadchannel",
    payment: {
      protocol: "x402",
      version: 2,
      price: `$${cfg.priceUsd} USDC`,
      network: cfg.network.label,
      networkId: cfg.network.caip2,
      payTo: cfg.payTo
    },
    endpoints: {
      "GET /facilitator": { paid: false },
      "GET /llms.txt": { paid: false },
      "GET /openapi.json": { paid: false },
      [`${PROBE_ROUTE.method} ${PROBE_ROUTE.path}`]: {
        paid: true,
        input: PROBE_ROUTE.inputExample,
        output: PROBE_ROUTE.outputExample
      },
      "GET /health": { paid: false }
    },
    note: "You are only charged when the check produces a result. Failures settle nothing."
  };
}
function prefersHtml(req) {
  const accept = header(req, "accept") ?? "";
  if (!accept.includes("text/html")) return false;
  const html = accept.indexOf("text/html");
  const json = accept.indexOf("application/json");
  return json === -1 || html < json;
}
function sendText(res, body) {
  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=3600"
  });
  res.end(body);
}
function sendSvg(res, body) {
  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=86400"
  });
  res.end(body);
}
function sendHtml(res, body) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=300",
    // Without this a CDN caches the page against the bare URL and then serves
    // HTML to agents asking for JSON. Any cached negotiated response needs it.
    vary: "Accept"
  });
  res.end(body);
}
function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES2) throw new BadRequest("body too large");
    chunks.push(chunk);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function send(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    vary: "Accept"
  });
  res.end(payload);
}
function log(level, fields) {
  process.stdout.write(`${JSON.stringify({ t: (/* @__PURE__ */ new Date()).toISOString(), level, ...fields })}
`);
}
function describe(err) {
  if (err instanceof FacilitatorError) return `${err.message}${err.body ? ` :: ${err.body}` : ""}`;
  return err instanceof Error ? err.message : String(err);
}
async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}

See .env.example for the required variables.
`);
      process.exit(78);
    }
    throw err;
  }
  const facilitator = new FacilitatorClient(cfg.facilitatorUrl, facilitatorAuth(cfg));
  try {
    const kinds = await facilitator.supported();
    const canSettle = kinds.some((k) => k.network === cfg.network.caip2 && k.scheme === "exact");
    if (!canSettle) {
      process.stderr.write(
        `facilitator ${cfg.facilitatorUrl} does not support exact/${cfg.network.caip2}
it supports: ${kinds.map((k) => `${k.scheme}/${k.network}`).join(", ") || "(nothing)"}
`
      );
      process.exit(78);
    }
  } catch (err) {
    process.stderr.write(`could not reach facilitator: ${describe(err)}
`);
    process.exit(75);
  }
  createApp(cfg, facilitator).listen(cfg.port, () => {
    log("info", {
      msg: "listening",
      port: cfg.port,
      url: cfg.publicUrl,
      network: cfg.network.label,
      price: `$${cfg.priceUsd}`,
      payTo: cfg.payTo,
      facilitator: cfg.facilitatorUrl
    });
  });
}
if (import.meta.filename === process.argv[1]) {
  await main();
}

// src/server/vercel-entry.ts
var handler = null;
var configProblems = null;
try {
  const cfg = loadConfig();
  handler = createHandler(cfg, new FacilitatorClient(cfg.facilitatorUrl, facilitatorAuth(cfg)));
} catch (err) {
  configProblems = err instanceof ConfigError ? err.problems : [String(err)];
}
function vercel_entry_default(req, res) {
  if (!handler) {
    const body = JSON.stringify({ error: "service misconfigured", problems: configProblems }, null, 2);
    res.writeHead(503, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  handler(req, res);
}
export {
  vercel_entry_default as default
};
