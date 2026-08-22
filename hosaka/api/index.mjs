// hosaka/hosaka.config.json
var hosaka_config_default = {
  $comment: "Public deployment settings for Hosaka. Same payout address as deadchannel on purpose: the Bazaar rolls volume up per address, so two shops under one wallet accumulate together instead of splitting. Settles through CDP because only that facilitator indexes into the 15,000-entry catalog, and indexing is triggered by the first settled payment.",
  payTo: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
  network: "base",
  priceUsd: 1e-3,
  publicUrl: "https://hosaka-agents.vercel.app",
  facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402"
};

// deadchannel.config.json
var deadchannel_config_default = {
  $comment: "Public deployment settings. Environment variables override every field. The payout address is public information by design: an x402 seller never holds a private key, it only declares where settlement should land. Publishing it here rather than hiding it in a dashboard means anyone can audit where the money goes.",
  payTo: "0x712c78928080Adb009E31315c0c3c7473dA9648a",
  network: "base",
  priceUsd: 1e-3,
  publicUrl: "https://deadchannel.vercel.app",
  facilitatorUrl: "https://facilitator.goplausible.xyz"
};

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
  const problems2 = [];
  const file = env["X402_IGNORE_CONFIG_FILE"] === "1" ? {} : defaults;
  const networkKey = env["X402_NETWORK"] ?? file.network ?? "base-sepolia";
  const network = NETWORKS[networkKey];
  if (!network) {
    problems2.push(`X402_NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}, got "${networkKey}"`);
  }
  const payTo = env["X402_PAY_TO"] ?? file.payTo ?? "";
  if (!EVM_ADDRESS.test(payTo)) {
    problems2.push(`X402_PAY_TO must be a 0x-prefixed 40-hex-digit address, got "${payTo || "(unset)"}"`);
  }
  if (/^0x0{40}$/i.test(payTo)) {
    problems2.push("X402_PAY_TO is the zero address \u2014 payments would be destroyed");
  }
  const priceUsd = Number(env["X402_PRICE_USD"] ?? file.priceUsd ?? 1e-3);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    problems2.push(`X402_PRICE_USD must be a positive number, got "${env["X402_PRICE_USD"]}"`);
  }
  const port = Number(env["PORT"] ?? "8402");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems2.push(`PORT must be a valid port number, got "${env["PORT"]}"`);
  }
  if (problems2.length > 0) {
    throw new ConfigError(problems2);
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
    maxTimeoutSeconds: Number(env["X402_MAX_TIMEOUT_SECONDS"] ?? "120")
  };
}
var ConfigError = class extends Error {
  problems;
  constructor(problems2) {
    super(`invalid configuration:
  - ${problems2.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems2;
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

// src/hosaka/server/app.ts
import { createServer } from "node:http";

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
      }
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

// src/server/paid.ts
var BadInput = class extends Error {
};
var MAX_BODY_BYTES = 32 * 1024;
async function servePaid(req, cfg, facilitator, deps) {
  const priced = deps.priceUsd === void 0 ? cfg : withPrice(cfg, deps.priceUsd);
  const required = buildPaymentRequired(priced, deps.route);
  const terms = required.accepts[0];
  if (!terms) return { status: 500, body: { error: "no payment terms configured" }, headers: {} };
  const signature = decodePaymentSignature(header(req, HEADER_SIGNATURE));
  if (!signature) {
    return {
      status: 402,
      headers: { [HEADER_REQUIRED]: encodeHeader(required) },
      body: {
        error: "payment required",
        price: `$${priced.priceUsd}`,
        network: priced.network.label,
        hint: `send a signed PaymentPayload in the ${HEADER_SIGNATURE} header`
      }
    };
  }
  let request;
  try {
    request = deps.parse(await readJson(req));
  } catch (err) {
    return {
      status: 400,
      headers: {},
      body: { error: err instanceof BadInput ? err.message : "body must be valid JSON" }
    };
  }
  const agreed = matchesOurTerms(signature.accepted, terms);
  if (!agreed.ok) {
    return {
      status: 402,
      headers: { [HEADER_REQUIRED]: encodeHeader(buildPaymentRequired(priced, deps.route, agreed.reason)) },
      body: { error: "payment terms mismatch", reason: agreed.reason }
    };
  }
  let verification;
  try {
    verification = await facilitator.verify(signature, terms);
  } catch (err) {
    const refusal = refusalFrom(err);
    if (refusal) {
      return {
        status: 402,
        headers: { [HEADER_REQUIRED]: encodeHeader(required) },
        body: { error: "payment invalid", reason: refusal }
      };
    }
    return { status: 502, headers: {}, body: { error: "payment verification unavailable" } };
  }
  if (!verification.isValid) {
    return {
      status: 402,
      headers: { [HEADER_REQUIRED]: encodeHeader(required) },
      body: { error: "payment invalid", reason: verification.invalidReason ?? "unknown" }
    };
  }
  let result;
  try {
    result = await deps.run(request);
  } catch {
    return { status: 502, headers: {}, body: { error: "request failed, you were not charged" } };
  }
  let settlement;
  try {
    settlement = await facilitator.settle(signature, terms);
  } catch (err) {
    const refusal = refusalFrom(err);
    if (refusal) {
      return { status: 402, headers: {}, body: { error: "settlement refused", reason: refusal } };
    }
    return { status: 502, headers: {}, body: { error: "settlement unavailable, you were not charged" } };
  }
  if (!settlement.success) {
    return {
      status: 402,
      headers: { [HEADER_RESPONSE]: encodeHeader(settlement) },
      body: { error: "settlement failed", reason: settlement.errorReason ?? "unknown" }
    };
  }
  return {
    status: 200,
    headers: { [HEADER_RESPONSE]: encodeHeader(settlement) },
    body: result,
    settled: {
      transaction: settlement.transaction,
      payer: settlement.payer ?? verification.payer,
      priceUsd: priced.priceUsd
    }
  };
}
function refusalFrom(err) {
  if (!(err instanceof FacilitatorError)) return null;
  if (err.status === null || err.status < 400 || err.status >= 500) return null;
  const body = err.body ?? "";
  try {
    const parsed = JSON.parse(body);
    return parsed.invalidReason ?? parsed.errorReason ?? parsed.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200) || `facilitator returned ${err.status}`;
  }
}
function withPrice(cfg, priceUsd) {
  return { ...cfg, priceUsd, priceAtomic: toAtomic(priceUsd, USDC_DECIMALS) };
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
    if (total > MAX_BODY_BYTES) throw new BadInput("body too large");
    chunks.push(chunk);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function applyOutcome(res, outcome) {
  const payload = JSON.stringify(outcome.body, null, 2);
  res.writeHead(outcome.status, {
    ...outcome.headers,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    vary: "Accept"
  });
  res.end(payload);
}

// src/hosaka/sources/dns.ts
var RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve"
];
async function query(name, type, timeoutMs) {
  for (const base of RESOLVERS) {
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) continue;
      const body = await res.json();
      return body.Answer ?? [];
    } catch {
    }
  }
  return [];
}
function unquote(data) {
  return data.replace(/"\s*"/g, "").replace(/^"|"$/g, "");
}
async function collectDns(domain, timeoutMs = 6e3) {
  const [a, mx, ns, txt, dmarcTxt] = await Promise.all([
    query(domain, "A", timeoutMs),
    query(domain, "MX", timeoutMs),
    query(domain, "NS", timeoutMs),
    query(domain, "TXT", timeoutMs),
    query(`_dmarc.${domain}`, "TXT", timeoutMs)
  ]);
  const txtValues = txt.map((r) => unquote(r.data));
  return {
    a: a.map((r) => r.data),
    // MX arrives as "10 mail.example.com." — keep the host, drop priority and dot.
    mx: mx.map((r) => r.data.replace(/^\d+\s+/, "").replace(/\.$/, "")),
    ns: ns.map((r) => r.data.replace(/\.$/, "")),
    txtCount: txtValues.length,
    spf: txtValues.find((v) => v.toLowerCase().startsWith("v=spf1")) ?? null,
    dmarc: dmarcTxt.map((r) => unquote(r.data)).find((v) => v.toLowerCase().startsWith("v=dmarc1")) ?? null
  };
}
async function collectTxt(domain, timeoutMs = 6e3) {
  return (await query(domain, "TXT", timeoutMs)).map((r) => unquote(r.data));
}

// src/hosaka/sources/rdap.ts
async function endpoints(domain, timeoutMs) {
  const urls = [`https://rdap.org/domain/${encodeURIComponent(domain)}`];
  const tld = domain.split(".").pop() ?? "";
  try {
    const res = await fetch("https://data.iana.org/rdap/dns.json", {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.ok) {
      const dns = await res.json();
      for (const [tlds, servers] of dns.services ?? []) {
        if (!tlds.includes(tld)) continue;
        for (const server of servers) {
          urls.push(`${server.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`);
        }
      }
    }
  } catch {
  }
  return urls;
}
async function collectRegistration(domain, timeoutMs = 8e3) {
  let lastError = "no rdap endpoint answered";
  let body = null;
  for (const url of await endpoints(domain, timeoutMs)) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/rdap+json" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) {
        lastError = `${new URL(url).host} returned ${res.status}`;
        continue;
      }
      body = await res.json();
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!body) throw new Error(lastError);
  const parsed = body;
  const events = new Map((parsed.events ?? []).map((e) => [e.eventAction, e.eventDate]));
  const registered = events.get("registration") ?? null;
  return {
    registered,
    expires: events.get("expiration") ?? null,
    registrar: registrarName(parsed.entities ?? []),
    status: parsed.status ?? [],
    ageYears: registered ? yearsSince(registered) : null
  };
}
function registrarName(entities) {
  const registrar = entities.find((e) => e.roles?.includes("registrar"));
  const vcard = registrar?.vcardArray?.[1] ?? [];
  const fn = vcard.find((entry) => Array.isArray(entry) && entry[0] === "fn");
  return Array.isArray(fn) && typeof fn[3] === "string" ? fn[3] : null;
}
function yearsSince(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.floor((Date.now() - then) / (365.25 * 864e5));
}

// src/hosaka/sources/tls.ts
import { connect } from "node:tls";
function collectTls(domain, timeoutMs = 8e3) {
  return new Promise((resolve, reject) => {
    const socket = connect(
      { host: domain, port: 443, servername: domain, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate(false);
        socket.destroy();
        if (!cert || Object.keys(cert).length === 0) {
          reject(new Error("no certificate presented"));
          return;
        }
        resolve({
          // Node types these as string | string[]; a multi-valued O is legal.
          issuer: first(cert.issuer?.O) ?? first(cert.issuer?.CN),
          validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
          validTo: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
          altNames: (cert.subjectaltname ?? "").split(",").map((s) => s.trim().replace(/^DNS:/, "")).filter((s) => s.length > 0)
        });
      }
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("tls handshake timed out"));
    });
    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}
function first(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// src/hosaka/sources/web.ts
var MAX_BYTES = 400 * 1024;
var UA = "Mozilla/5.0 (compatible; hosaka/1.0; +https://github.com/plus8bit/deadchannel)";
async function collectWeb(domain, timeoutMs = 1e4) {
  const res = await fetch(`https://${domain}`, {
    redirect: "follow",
    headers: { "user-agent": UA, accept: "text/html,*/*" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const html = await readCapped(res);
  return {
    facts: {
      status: res.status,
      finalUrl: res.url || null,
      title: extract(html, /<title[^>]*>([\s\S]{1,300}?)<\/title>/i),
      description: extract(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]{1,400}?)["']/i),
      server: res.headers.get("server"),
      poweredBy: res.headers.get("x-powered-by"),
      hsts: res.headers.has("strict-transport-security"),
      htmlBytes: Buffer.byteLength(html)
    },
    html
  };
}
async function readCapped(res) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(Buffer.from(value));
        total += value.byteLength;
      }
    }
  } catch {
  } finally {
    void reader.cancel().catch(() => {
    });
  }
  return Buffer.concat(chunks).toString("utf8");
}
function extract(html, re) {
  const m = re.exec(html);
  if (!m?.[1]) return null;
  return m[1].replace(/\s+/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

// src/hosaka/vendors.ts
var TXT_RULES = [
  { name: "Google Workspace", category: "productivity", pattern: /google-site-verification/i },
  { name: "Microsoft 365", category: "productivity", pattern: /^ms=|microsoft-domain-verification/i },
  { name: "Atlassian", category: "engineering", pattern: /atlassian-domain-verification/i },
  { name: "Anthropic", category: "ai", pattern: /anthropic-domain-verification/i },
  { name: "OpenAI", category: "ai", pattern: /openai-domain-verification/i },
  { name: "Slack", category: "communication", pattern: /slack-domain-verification/i },
  { name: "Zoom", category: "communication", pattern: /zoom-domain-verification/i },
  { name: "Docusign", category: "legal", pattern: /docusign=/i },
  { name: "Adobe", category: "design", pattern: /adobe-idp-site-verification|adobe-sign-verification/i },
  { name: "Canva", category: "design", pattern: /canva-site-verification/i },
  { name: "Figma", category: "design", pattern: /figma-domain-verification/i },
  { name: "Stripe", category: "payments", pattern: /stripe-verification/i },
  { name: "Facebook / Meta", category: "advertising", pattern: /facebook-domain-verification/i },
  { name: "Apple", category: "platform", pattern: /apple-domain-verification/i },
  { name: "Miro", category: "productivity", pattern: /miro-verification/i },
  { name: "Notion", category: "productivity", pattern: /notion-domain-verification/i },
  { name: "Dropbox", category: "storage", pattern: /dropbox-domain-verification/i },
  { name: "Webex", category: "communication", pattern: /cisco-ci-domain-verification/i },
  { name: "Citrix", category: "it", pattern: /citrix-verification-code/i },
  { name: "Mongo Atlas", category: "engineering", pattern: /mongodb-site-verification/i },
  { name: "Loom", category: "productivity", pattern: /loom-site-verification/i },
  { name: "Klaviyo", category: "marketing", pattern: /klaviyo-site-verification/i }
];
var SPF_RULES = [
  { name: "Google Workspace", category: "email", pattern: /_spf\.google\.com/i },
  { name: "Microsoft 365", category: "email", pattern: /spf\.protection\.outlook\.com/i },
  { name: "Salesforce", category: "crm", pattern: /_spf\.salesforce\.com|_spfblock\.salesforce/i },
  { name: "HubSpot", category: "crm", pattern: /spf\.hubspot|hubspotemail/i },
  { name: "Marketo", category: "marketing", pattern: /mktomail|marketo/i },
  { name: "Mailchimp", category: "marketing", pattern: /spf\.mandrillapp|servers\.mcsv\.net/i },
  { name: "SendGrid", category: "email", pattern: /sendgrid\.net/i },
  { name: "Mailgun", category: "email", pattern: /mailgun\.org/i },
  { name: "Postmark", category: "email", pattern: /spf\.mtasv\.net/i },
  { name: "Amazon SES", category: "email", pattern: /amazonses\.com/i },
  { name: "Zendesk", category: "support", pattern: /mail\.zendesk\.com/i },
  { name: "Intercom", category: "support", pattern: /_spf\.intercom|intercom-mail/i },
  { name: "Freshworks", category: "support", pattern: /freshemail|freshdesk/i },
  { name: "Atlassian", category: "engineering", pattern: /_spf\.atlassian\.net/i },
  { name: "Workday", category: "hr", pattern: /workday\.com/i },
  { name: "Greenhouse", category: "hr", pattern: /greenhouse\.io/i },
  { name: "Docusign", category: "legal", pattern: /spf\.docusign/i },
  { name: "Qualtrics", category: "research", pattern: /qualtrics\.com/i },
  { name: "Braze", category: "marketing", pattern: /braze\.com/i },
  { name: "Customer.io", category: "marketing", pattern: /customeriomail/i },
  { name: "Klaviyo", category: "marketing", pattern: /klaviyomail/i }
];
var MX_RULES = [
  { name: "Google Workspace", category: "email", pattern: /aspmx.*google|googlemail/i },
  { name: "Microsoft 365", category: "email", pattern: /mail\.protection\.outlook/i },
  { name: "Proofpoint", category: "security", pattern: /pphosted|proofpoint/i },
  { name: "Mimecast", category: "security", pattern: /mimecast/i },
  { name: "Zoho Mail", category: "email", pattern: /zoho/i },
  { name: "Fastmail", category: "email", pattern: /messagingengine/i },
  { name: "Barracuda", category: "security", pattern: /barracudanetworks/i }
];
var NS_RULES = [
  { name: "AWS Route 53", category: "cloud", pattern: /awsdns/i },
  { name: "Cloudflare", category: "cloud", pattern: /\.ns\.cloudflare\.com|cloudflare/i },
  { name: "Azure DNS", category: "cloud", pattern: /azure-dns/i },
  { name: "Google Cloud DNS", category: "cloud", pattern: /googledomains|google\.com$/i },
  { name: "NS1", category: "cloud", pattern: /nsone\.net/i },
  { name: "Akamai", category: "cloud", pattern: /akam\.net|akamai/i },
  { name: "DNSimple", category: "cloud", pattern: /dnsimple/i },
  { name: "Vercel", category: "hosting", pattern: /vercel-dns/i }
];
var WEB_RULES = [
  { name: "Google Analytics", category: "analytics", pattern: /googletagmanager\.com\/gtag|google-analytics\.com\/analytics/i },
  { name: "Segment", category: "analytics", pattern: /cdn\.segment\.(com|io)\//i },
  { name: "Amplitude", category: "analytics", pattern: /cdn\.amplitude\.com|api\.amplitude\.com/i },
  { name: "Mixpanel", category: "analytics", pattern: /cdn\.mxpnl\.com|api\.mixpanel\.com/i },
  { name: "Hotjar", category: "analytics", pattern: /static\.hotjar\.com|script\.hotjar\.com/i },
  { name: "Intercom", category: "support", pattern: /widget\.intercom\.io|js\.intercomcdn\.com/i },
  { name: "Zendesk", category: "support", pattern: /static\.zdassets\.com|ekr\.zdassets\.com/i },
  { name: "Drift", category: "support", pattern: /js\.driftt\.com/i },
  { name: "HubSpot", category: "crm", pattern: /js\.hs-scripts\.com|js\.hsforms\.net|track\.hubspot\.com/i },
  { name: "Stripe", category: "payments", pattern: /js\.stripe\.com\/v\d/i },
  { name: "Shopify", category: "ecommerce", pattern: /cdn\.shopify\.com\/s\/|myshopify\.com/i },
  { name: "Sentry", category: "engineering", pattern: /browser\.sentry-cdn\.com|ingest\.sentry\.io/i },
  { name: "Datadog", category: "engineering", pattern: /datadoghq-browser-agent|browser-intake-datadoghq/i },
  { name: "Next.js", category: "framework", pattern: /\/_next\/static\/|__NEXT_DATA__/i },
  { name: "Vue", category: "framework", pattern: /__VUE__|vue@\d|vue\.runtime/i },
  { name: "WordPress", category: "cms", pattern: /\/wp-content\/|\/wp-includes\//i },
  { name: "Webflow", category: "cms", pattern: /assets\.website-files\.com|webflow\.js/i },
  { name: "Contentful", category: "cms", pattern: /images\.ctfassets\.net|cdn\.contentful\.com/i },
  { name: "Cloudflare", category: "cloud", pattern: /static\.cloudflareinsights\.com|\/cdn-cgi\//i }
];
function match(rules, values, label, confidence) {
  const found = [];
  for (const rule of rules) {
    for (const value of values) {
      const m = rule.pattern.exec(value);
      if (!m) continue;
      found.push({
        name: rule.name,
        category: rule.category,
        // Quote the fragment that matched, not the haystack. Evidence pointing
        // at 400KB of HTML is not evidence a buyer can check.
        evidence: `${label}: ${excerpt(value, m.index, m[0].length)}`,
        confidence
      });
      break;
    }
  }
  return found;
}
function excerpt(value, index, length) {
  if (value.length <= 90) return value;
  const start = Math.max(0, index - 20);
  const end = Math.min(value.length, index + length + 30);
  return `${start > 0 ? "\u2026" : ""}${value.slice(start, end).replace(/\s+/g, " ")}${end < value.length ? "\u2026" : ""}`;
}
function detectVendors(input) {
  const found = [];
  found.push(...match(TXT_RULES, input.txt, "DNS TXT", "high"));
  const spfParts = (input.dns?.spf ?? "").split(/\s+/).filter((p) => p.length > 0);
  found.push(...match(SPF_RULES, spfParts, "SPF", "high"));
  found.push(...match(MX_RULES, input.dns?.mx ?? [], "MX", "high"));
  found.push(...match(NS_RULES, input.dns?.ns ?? [], "NS", "high"));
  if (input.html) {
    const headers = [input.web?.server ?? "", input.web?.poweredBy ?? ""].filter(Boolean);
    found.push(...match(WEB_RULES, [input.html, ...headers], "page", "medium"));
  }
  const best = /* @__PURE__ */ new Map();
  for (const v of found) {
    const seen = best.get(v.name);
    if (!seen || seen.confidence === "medium" && v.confidence === "high") best.set(v.name, v);
  }
  return [...best.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
function providerFor(kind, hosts) {
  if (hosts.length === 0) return null;
  const rules = kind === "mx" ? MX_RULES : NS_RULES;
  for (const rule of rules) {
    if (hosts.some((h) => rule.pattern.test(h))) return rule.name;
  }
  return hosts[0] ?? null;
}

// src/hosaka/profile.ts
var FREE = 0;
async function buildProfile(domain, options = {}) {
  const host = normalize(domain);
  const t = options.timeoutMs ?? 9e3;
  const gaps = [];
  const [dns, txt, registration, tls, web] = await Promise.all([
    settle(collectDns(host, t), "dns", gaps),
    settle(collectTxt(host, t), "dns-txt", gaps),
    settle(collectRegistration(host, t), "rdap", gaps),
    settle(collectTls(host, t), "tls", gaps),
    settle(collectWeb(host, t), "web", gaps)
  ]);
  return {
    domain: host,
    collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    dns: fact(dns, "observed", "DNS over HTTPS"),
    registration: fact(registration, "observed", "RDAP registry"),
    tls: fact(tls, "observed", "TLS handshake"),
    web: fact(web?.facts ?? null, "observed", "HTTP response"),
    vendors: detectVendors({
      txt: txt ?? [],
      dns: dns ?? null,
      web: web?.facts ?? null,
      html: web?.html ?? null
    }),
    gaps,
    costUsd: FREE
  };
}
async function settle(promise, name, gaps) {
  try {
    return await promise;
  } catch (err) {
    gaps.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
function fact(value, from, source) {
  return value === null ? null : { value, from, source };
}
function normalize(input) {
  const trimmed = input.trim().toLowerCase();
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    throw new Error(`not a usable domain: ${input}`);
  }
  return host.replace(/^www\./, "");
}

// src/hosaka/store.ts
var MemoryStore = class {
  #items = /* @__PURE__ */ new Map();
  #maxItems;
  #now;
  #hits = 0;
  #misses = 0;
  constructor(options = {}) {
    this.#maxItems = options.maxItems ?? 5e3;
    this.#now = options.now ?? Date.now;
  }
  async get(key) {
    const item = this.#items.get(key);
    if (!item) {
      this.#misses++;
      return null;
    }
    if (item.expiresAt <= this.#now()) {
      this.#items.delete(key);
      this.#misses++;
      return null;
    }
    this.#hits++;
    return item;
  }
  async put(key, value, options) {
    const now = this.#now();
    const previous = this.#items.get(key);
    this.#items.delete(key);
    this.#items.set(key, {
      value,
      storedAt: now,
      expiresAt: now + options.ttlMs,
      costUsd: (previous?.costUsd ?? 0) + options.costUsd,
      sold: previous?.sold ?? 0
    });
    this.#evict();
  }
  async recordSale(key) {
    const item = this.#items.get(key);
    if (item) item.sold++;
  }
  async stats() {
    let sold = 0;
    let costUsd = 0;
    for (const item of this.#items.values()) {
      sold += item.sold;
      costUsd += item.costUsd;
    }
    return { items: this.#items.size, sold, costUsd, hits: this.#hits, misses: this.#misses };
  }
  /** Insertion-ordered Map: the first key is the oldest. */
  #evict() {
    while (this.#items.size > this.#maxItems) {
      const oldest = this.#items.keys().next();
      if (oldest.done) break;
      this.#items.delete(oldest.value);
    }
  }
};

// src/hosaka/server/routes.ts
var PRICE_LOOKUP = 5e-3;
var PRICE_DOSSIER = 0.05;
var TTL_MS = 24 * 60 * 60 * 1e3;
var warehouse = new MemoryStore({ maxItems: 5e3 });
function parseDomainRequest(body) {
  if (typeof body !== "object" || body === null) throw new BadInput("body must be a JSON object");
  const raw = body["domain"];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new BadInput('`domain` is required, e.g. {"domain":"figma.com"}');
  }
  let domain;
  try {
    domain = normalize(raw);
  } catch (err) {
    throw new BadInput(err instanceof Error ? err.message : "unusable domain");
  }
  if (!domain.includes(".") || domain.length > 253) throw new BadInput(`not a domain: ${raw}`);
  if (isPrivateHost(domain)) throw new BadInput("`domain` must be a public host");
  return { domain };
}
function isPrivateHost(host) {
  if (/^(localhost|.*\.(localhost|internal|local|home|lan))$/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 10 || a === 127 || a === 0 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
}
async function stocked(domain) {
  const held = await warehouse.get(domain);
  if (held) {
    await warehouse.recordSale(domain);
    return { profile: held.value, fromWarehouse: true };
  }
  const profile = await buildProfile(domain);
  await warehouse.put(domain, profile, { ttlMs: TTL_MS, costUsd: profile.costUsd });
  await warehouse.recordSale(domain);
  return { profile, fromWarehouse: false };
}
async function runLookup(req) {
  const { profile } = await stocked(req.domain);
  return {
    domain: profile.domain,
    ageYears: profile.registration?.value.ageYears ?? null,
    registrar: profile.registration?.value.registrar ?? null,
    // Asked of the records directly: the deduplicated vendor list keeps only
    // the strongest evidence per vendor, which loses the MX/NS attribution.
    mailProvider: providerFor("mx", profile.dns?.value.mx ?? []),
    dnsProvider: providerFor("ns", profile.dns?.value.ns ?? []),
    dmarc: Boolean(profile.dns?.value.dmarc),
    https: Boolean(profile.tls),
    title: profile.web?.value.title ?? null,
    vendorCount: profile.vendors.length,
    collectedAt: profile.collectedAt
  };
}
async function runDossier(req) {
  const { profile } = await stocked(req.domain);
  return profile;
}
function warehouseStats() {
  return warehouse.stats();
}
var LOOKUP_ROUTE = {
  path: "/lookup",
  method: "POST",
  serviceName: "Hosaka",
  description: "Fast company look-up from a domain: age, registrar, mail and DNS provider, DMARC, HTTPS, and how many third-party vendors we can see. One call, no signup, no API key.",
  tags: ["company-data", "enrichment", "domain", "b2b", "technographics"],
  mimeType: "application/json",
  inputExample: { domain: "figma.com" },
  inputSchema: {
    type: "object",
    properties: { domain: { type: "string", description: "Company domain, e.g. figma.com" } },
    required: ["domain"]
  },
  outputExample: {
    domain: "figma.com",
    ageYears: 27,
    registrar: "Amazon Registrar, Inc.",
    mailProvider: "Google Workspace",
    dnsProvider: "AWS Route 53",
    dmarc: true,
    https: true,
    title: "Figma: The collaborative canvas for design, code, and AI",
    vendorCount: 17
  }
};
var DOSSIER_ROUTE = {
  path: "/dossier",
  method: "POST",
  serviceName: "Hosaka",
  description: "Full company dossier from a domain: every third-party vendor we can prove they use, with the DNS record or script that proves it, plus registration, mail, certificate and site facts. Technographics without a subscription.",
  tags: ["technographics", "company-data", "vendor-stack", "b2b", "enrichment"],
  mimeType: "application/json",
  inputExample: { domain: "figma.com" },
  inputSchema: {
    type: "object",
    properties: { domain: { type: "string", description: "Company domain, e.g. figma.com" } },
    required: ["domain"]
  },
  outputExample: {
    domain: "figma.com",
    vendors: [
      { name: "Stripe", category: "payments", evidence: "DNS TXT: stripe-verification=82ce\u2026", confidence: "high" },
      { name: "Greenhouse", category: "hr", evidence: "SPF: include:greenhouse.io", confidence: "high" }
    ],
    registration: { value: { ageYears: 27, registrar: "Amazon Registrar, Inc." }, from: "observed" },
    gaps: []
  }
};

// src/hosaka/server/app.ts
var SHELVES = [
  { route: LOOKUP_ROUTE, parse: parseDomainRequest, run: runLookup, priceUsd: PRICE_LOOKUP },
  { route: DOSSIER_ROUTE, parse: parseDomainRequest, run: runDossier, priceUsd: PRICE_DOSSIER }
];
function createHandler(cfg, facilitator) {
  return (req, res) => {
    handle(req, res, cfg, facilitator).catch((err) => {
      log("error", { msg: "unhandled", err: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    });
  };
}
async function handle(req, res, cfg, facilitator) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, PAYMENT-SIGNATURE");
  res.setHeader("access-control-expose-headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.writeHead(204).end();
    return;
  }
  if (path === "/health") return send(res, 200, { ok: true, network: cfg.network.label });
  if (path === "/facilitator") return send(res, ...await facilitatorStatus(cfg, facilitator));
  if (path === "/warehouse") return send(res, 200, await warehouseStats());
  if (path === "/" || path === "/index.json") return send(res, 200, card(cfg));
  const shelf = SHELVES.find((s) => s.route.path === path);
  if (!shelf) {
    return send(res, 404, {
      error: "not found",
      endpoints: SHELVES.map((s) => `${s.route.method} ${s.route.path}`).concat(
        "GET /",
        "GET /health",
        "GET /facilitator",
        "GET /warehouse"
      )
    });
  }
  if (req.method !== shelf.route.method) {
    res.setHeader("allow", shelf.route.method);
    return send(res, 405, { error: `use ${shelf.route.method} ${shelf.route.path}` });
  }
  const outcome = await servePaid(req, cfg, facilitator, shelf);
  if (outcome.settled) {
    log("info", { msg: "sold", shelf: shelf.route.path, usd: outcome.settled.priceUsd, tx: outcome.settled.transaction, payer: outcome.settled.payer });
  }
  applyOutcome(res, outcome);
}
async function facilitatorStatus(cfg, facilitator) {
  const base = { facilitator: cfg.facilitatorUrl, network: cfg.network.caip2, scheme: "exact" };
  try {
    const kinds = await facilitator.supported();
    const canSettle = kinds.some((k) => k.network === cfg.network.caip2 && k.scheme === "exact");
    return [
      canSettle ? 200 : 503,
      {
        ...base,
        reachable: true,
        authenticated: true,
        canSettle,
        ...canSettle ? {} : { problem: `cannot settle exact on ${cfg.network.caip2}` }
      }
    ];
  } catch (err) {
    const status = err instanceof FacilitatorError ? err.status : null;
    const authProblem = status === 401 || status === 403;
    return [
      503,
      {
        ...base,
        reachable: !authProblem,
        authenticated: false,
        canSettle: false,
        problem: authProblem ? "the facilitator rejected our credentials \u2014 set CDP_API_KEY_ID and CDP_API_KEY_SECRET on this project" : err instanceof Error ? err.message : String(err)
      }
    ];
  }
}
function card(cfg) {
  return {
    service: "Hosaka",
    description: "Company facts for agents. Pay per call in USDC, no signup, no API key.",
    source: "https://github.com/plus8bit/deadchannel",
    payment: {
      protocol: "x402",
      version: 2,
      network: cfg.network.label,
      networkId: cfg.network.caip2,
      payTo: cfg.payTo
    },
    endpoints: Object.fromEntries(
      SHELVES.map((s) => [
        `${s.route.method} ${s.route.path}`,
        { price: `$${s.priceUsd} USDC`, input: s.route.inputExample, description: s.route.description }
      ])
    ),
    note: "You are only charged when the call produces a result. Failures settle nothing."
  };
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
async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}
`);
      process.exit(78);
    }
    throw err;
  }
  const facilitator = new FacilitatorClient(cfg.facilitatorUrl, facilitatorAuth(cfg));
  createServer(createHandler(cfg, facilitator)).listen(cfg.port, () => {
    log("info", { msg: "hosaka listening", port: cfg.port, network: cfg.network.label, payTo: cfg.payTo });
  });
}
if (import.meta.filename === process.argv[1]) {
  await main();
}

// src/hosaka/server/vercel-entry.ts
var handler = null;
var problems = null;
try {
  const cfg = loadConfig(process.env, hosaka_config_default);
  handler = createHandler(cfg, new FacilitatorClient(cfg.facilitatorUrl, facilitatorAuth(cfg)));
} catch (err) {
  problems = err instanceof ConfigError ? err.problems : [String(err)];
}
function vercel_entry_default(req, res) {
  if (!handler) {
    const body = JSON.stringify({ error: "service misconfigured", problems }, null, 2);
    res.writeHead(503, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  handler(req, res);
}
export {
  vercel_entry_default as default
};
