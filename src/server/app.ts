#!/usr/bin/env node
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ConfigError, loadConfig } from "./config.ts";
import type { Config } from "./config.ts";
import { FacilitatorClient, FacilitatorError } from "./facilitator.ts";
import { ALGORAND_MAINNET } from "./algorand.ts";
import { facilitatorsFor } from "./facilitator-router.ts";
import { SOLANA_RAIL } from "./rails.ts";
import type { FacilitatorFor } from "./facilitator-router.ts";
import { llmsTxt, openApiSpec } from "./descriptors.ts";
import { FAVICON_SVG, landingPage } from "./landing.ts";
import { BadRequest, PROBE_ROUTE, parseProbeRequest, runProbe } from "./routes.ts";
import {
  HEADER_REQUIRED,
  HEADER_RESPONSE,
  HEADER_SIGNATURE,
  buildPaymentRequired,
  decodePaymentSignature,
  encodeHeader,
  matchesOurTerms,
  selectTerms,
} from "./x402.ts";

const MAX_BODY_BYTES = 32 * 1024;

/** Injectable side effects, so the payment flow can be tested without network. */
export interface Deps {
  runProbe: typeof runProbe;
}

const DEFAULT_DEPS: Deps = { runProbe };

/**
 * The request handler on its own, so the same code serves a long-running
 * process and a serverless function without a second implementation.
 */
export function createHandler(
  cfg: Config,
  facilitator: FacilitatorClient | FacilitatorFor,
  deps: Deps = DEFAULT_DEPS,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(req, res, cfg, facilitator, deps).catch((err: unknown) => {
      log("error", { msg: "unhandled", err: describe(err) });
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    });
  };
}

export function createApp(cfg: Config, facilitator: FacilitatorClient | FacilitatorFor, deps: Deps = DEFAULT_DEPS) {
  return createServer(createHandler(cfg, facilitator, deps));
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
  facilitator: FacilitatorClient | FacilitatorFor,
  deps: Deps,
): Promise<void> {
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
  // The same document Hosaka publishes: one machine-readable list of what is
  // for sale and what it costs, so an index can catalog the shop without being
  // told about it. Whether anything crawls it is unproven; it costs nothing.
  if (path === "/.well-known/x402") {
    const required = buildPaymentRequired(cfg, PROBE_ROUTE);
    return send(res, 200, {
      x402Version: 2,
      resources: [{ resource: required.resource, accepts: required.accepts, extensions: required.extensions }],
    });
  }
  if (path === "/" || path === "/index.json") {
    // One address, two audiences: browsers read the page, agents read the card.
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
    endpoints: [
      "GET /",
      "GET /health",
      "GET /facilitator",
      "GET /llms.txt",
      "GET /openapi.json",
      "GET /.well-known/x402",
      "POST /probe",
    ],
  });
}

/**
 * The `authorization` payment flow: verify → run the resource → settle.
 *
 * Settlement happens only after the probe actually produced a result, so a
 * failure on our side costs the buyer nothing. That is the whole pitch of this
 * service, and it would be absurd to charge for a broken response.
 */
async function handlePaidProbe(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
  facilitator: FacilitatorClient | FacilitatorFor,
  deps: Deps,
): Promise<void> {
  const required = buildPaymentRequired(cfg, PROBE_ROUTE);
  const signature = decodePaymentSignature(header(req, HEADER_SIGNATURE));
  // The offer the buyer chose, not the first one listed. Once a resource sells
  // on two chains, position tells you nothing about which terms were signed.
  const ourTerms = selectTerms(required.accepts, signature);
  if (!ourTerms) return send(res, 500, { error: "no payment terms configured" });

  if (!signature) {
    res.setHeader(HEADER_REQUIRED, encodeHeader(required));
    return send(res, 402, {
      error: "payment required",
      price: `$${cfg.priceUsd}`,
      network: cfg.network.label,
      hint: `send a signed PaymentPayload in the ${HEADER_SIGNATURE} header`,
    });
  }

  // Read the request before spending a facilitator round trip on a bad body.
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

  const settler = typeof facilitator === "function" ? facilitator(ourTerms.network) : facilitator;

  let verification;
  try {
    verification = await settler.verify(signature, ourTerms);
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
    // Resource failed. No settle call, so the buyer is not charged.
    log("error", { msg: "probe failed", url: request.url, err: describe(err) });
    return send(res, 502, { error: "probe failed, you were not charged" });
  }

  let settlement;
  try {
    settlement = await settler.settle(signature, ourTerms);
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
    usd: cfg.priceUsd,
  });

  res.setHeader(HEADER_RESPONSE, encodeHeader(settlement));
  send(res, 200, result);
}

/**
 * Proves the facilitator is reachable and that our credentials are accepted,
 * without moving any money.
 *
 * Worth its own route: a wrong CDP key otherwise stays invisible until a buyer
 * tries to pay, and the first person to discover it is a customer.
 */
async function handleFacilitatorCheck(
  res: ServerResponse,
  cfg: Config,
  facilitator: FacilitatorClient | FacilitatorFor,
): Promise<void> {
  const route = (n: string) => (typeof facilitator === "function" ? facilitator(n) : facilitator);

  // Every chain the shop advertises, not just the primary one. A chain routed
  // to a facilitator that will not settle it is an offer no buyer can complete,
  // and checking only the first one leaves it looking healthy right up until
  // somebody pays — which is exactly how we found the Solana rail was dead.
  const networks = [
    cfg.network.caip2,
    ...(cfg.algorandPayTo ? [ALGORAND_MAINNET] : []),
    ...cfg.rails.map((r) => r.caip2),
    ...(cfg.solanaPayTo ? [SOLANA_RAIL.caip2] : []),
  ];

  const chains = await Promise.all(
    networks.map(async (network) => {
      const client = route(network);
      try {
        const kinds = await client.supported();
        const canSettle = kinds.some((k) => k.network === network && k.scheme === "exact");
        return {
          network,
          facilitator: client.baseUrl,
          reachable: true,
          authenticated: true,
          canSettle,
          ...(canSettle ? {} : { problem: `facilitator cannot settle exact on ${network}` }),
        };
      } catch (err) {
        // 401/403 from a facilitator means credentials, not connectivity, and
        // the two are fixed in different places.
        const authProblem = err instanceof FacilitatorError && (err.status === 401 || err.status === 403);
        return {
          network,
          facilitator: client.baseUrl,
          reachable: !authProblem,
          authenticated: false,
          canSettle: false,
          problem: authProblem ? "the facilitator rejected our credentials" : describe(err),
        };
      }
    }),
  );

  const healthy = chains.every((c) => c.canSettle);
  send(res, healthy ? 200 : 503, { scheme: "exact", healthy, chains });
}

function serviceCard(cfg: Config) {
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
      payTo: cfg.payTo,
    },
    endpoints: {
      "GET /facilitator": { paid: false },
      "GET /llms.txt": { paid: false },
      "GET /openapi.json": { paid: false },
      [`${PROBE_ROUTE.method} ${PROBE_ROUTE.path}`]: {
        paid: true,
        input: PROBE_ROUTE.inputExample,
        output: PROBE_ROUTE.outputExample,
      },
      "GET /health": { paid: false },
    },
    note: "You are only charged when the check produces a result. Failures settle nothing.",
  };
}

/** True when the client asked for HTML ahead of JSON, as a browser does. */
function prefersHtml(req: IncomingMessage): boolean {
  const accept = header(req, "accept") ?? "";
  if (!accept.includes("text/html")) return false;
  const html = accept.indexOf("text/html");
  const json = accept.indexOf("application/json");
  return json === -1 || html < json;
}

function sendText(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=3600",
  });
  res.end(body);
}

function sendSvg(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=86400",
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=300",
    // Without this a CDN caches the page against the bare URL and then serves
    // HTML to agents asking for JSON. Any cached negotiated response needs it.
    vary: "Accept",
  });
  res.end(body);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new BadRequest("body too large");
    chunks.push(chunk as Buffer);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    vary: "Accept",
  });
  res.end(payload);
}

function log(level: "info" | "error", fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, ...fields })}\n`);
}

function describe(err: unknown): string {
  if (err instanceof FacilitatorError) return `${err.message}${err.body ? ` :: ${err.body}` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

/** Boot: fail loudly on bad config, and prove the facilitator can settle for us. */
async function main(): Promise<void> {
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n\nSee .env.example for the required variables.\n`);
      process.exit(78); // EX_CONFIG
    }
    throw err;
  }

  const facilitator = facilitatorsFor(cfg);

  try {
    // Every chain the service advertises, since each may have its own settler
    // and a chain nobody can settle is an offer nobody can accept.
    const networks = [cfg.network.caip2, ...(cfg.algorandPayTo ? [ALGORAND_MAINNET] : []), ...cfg.rails.map((r) => r.caip2), ...(cfg.solanaPayTo ? [SOLANA_RAIL.caip2] : [])];
    for (const network of networks) {
      const client = facilitator(network);
      const kinds = await client.supported();
      const canSettle = kinds.some((k) => k.network === network && k.scheme === "exact");
      if (!canSettle) {
        process.stderr.write(
          `facilitator ${client.baseUrl} does not support exact/${network}\n` +
            `it supports: ${kinds.map((k) => `${k.scheme}/${k.network}`).join(", ") || "(nothing)"}\n`,
        );
        process.exit(78);
      }
    }
  } catch (err) {
    process.stderr.write(`could not reach facilitator: ${describe(err)}\n`);
    process.exit(75); // EX_TEMPFAIL
  }

  createApp(cfg, facilitator).listen(cfg.port, () => {
    log("info", {
      msg: "listening",
      port: cfg.port,
      url: cfg.publicUrl,
      network: cfg.network.label,
      price: `$${cfg.priceUsd}`,
      payTo: cfg.payTo,
      facilitator: cfg.facilitatorUrl,
    });
  });
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
