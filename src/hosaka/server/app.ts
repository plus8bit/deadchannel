#!/usr/bin/env node
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ConfigError, loadConfig } from "../../server/config.ts";
import type { Config } from "../../server/config.ts";
import { FacilitatorClient, FacilitatorError } from "../../server/facilitator.ts";
import { facilitatorsFor } from "../../server/facilitator-router.ts";
import { hosakaLanding, HOSAKA_FAVICON } from "./landing.ts";
import { buildPaymentRequired } from "../../server/x402.ts";
import { ALGORAND_MAINNET } from "../../server/algorand.ts";
import type { FacilitatorFor } from "../../server/facilitator-router.ts";
import { facilitatorAuth } from "../../server/facilitator-auth.ts";
import { applyOutcome, readJson, servePaid, withPrice } from "../../server/paid.ts";
import type { PaidHandlerDeps } from "../../server/paid.ts";
import { PRICE_BUNDLE, PRICE_CONTACTS, runBundle } from "./bundle.ts";
import {
  BUNDLE_ROUTE,
  CONTACTS_ROUTE,
  DOSSIER_ROUTE,
  LOOKUP_ROUTE,
  PRICE_DOSSIER,
  PRICE_LOOKUP,
  parseDomainRequest,
  runDossier,
  runLookup,
  warehouseStats,
  runPreview,
} from "./routes.ts";
import type { DomainRequest } from "./routes.ts";

/**
 * Hosaka: a shop that sells company facts to agents.
 *
 * Two shelves behind one payout address. The catalog rolls volume up per
 * address, so a second SKU adds a listing without splitting the takings.
 */

type Shelf = PaidHandlerDeps<DomainRequest, unknown>;

const SHELVES: Shelf[] = [
  { route: LOOKUP_ROUTE, parse: parseDomainRequest, run: runLookup, priceUsd: PRICE_LOOKUP },
  { route: DOSSIER_ROUTE, parse: parseDomainRequest, run: runDossier, priceUsd: PRICE_DOSSIER },
  { route: BUNDLE_ROUTE, parse: parseDomainRequest, run: (r) => runBundle(r, "people"), priceUsd: PRICE_BUNDLE },
  { route: CONTACTS_ROUTE, parse: parseDomainRequest, run: (r) => runBundle(r, "contacts"), priceUsd: PRICE_CONTACTS },
];

export function createHandler(cfg: Config, facilitator: FacilitatorClient | FacilitatorFor) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res, cfg, facilitator).catch((err: unknown) => {
      log("error", { msg: "unhandled", err: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    });
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
  facilitator: FacilitatorClient | FacilitatorFor,
): Promise<void> {
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

  if (path === "/favicon.svg" || path === "/favicon.ico") {
    // Referenced by the page since it had a page; never actually served.
    res.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-length": Buffer.byteLength(HOSAKA_FAVICON),
      "cache-control": "public, max-age=86400",
    });
    res.end(HOSAKA_FAVICON);
    return;
  }
  if (path === "/health") return send(res, 200, { ok: true, network: cfg.network.label });
  if (path === "/facilitator") return send(res, ...(await facilitatorStatus(cfg, facilitator)));
  if (path === "/warehouse") return send(res, 200, await warehouseStats());
  // The listing mechanism agent indexes crawl: one document naming every paid
  // resource and what it costs, so a marketplace can catalog the shop without
  // being told about it.
  if (path === "/.well-known/x402") {
    return send(res, 200, {
      x402Version: 2,
      resources: SHELVES.map((shelf) => {
        // withPrice, not a spread: the 402 reads priceAtomic, so overriding
        // priceUsd alone would advertise every shelf at the base price.
        const priced = shelf.priceUsd === undefined ? cfg : withPrice(cfg, shelf.priceUsd);
        const required = buildPaymentRequired(priced, shelf.route);
        return { resource: required.resource, accepts: required.accepts, extensions: required.extensions };
      }),
    });
  }
  if (path === "/preview" && req.method === "POST") {
    try {
      return send(res, 200, await runPreview(parseDomainRequest(await readJson(req))));
    } catch (err) {
      return send(res, 400, { error: err instanceof Error ? err.message : "bad request" });
    }
  }
  // A person and an agent arrive at the same URL wanting opposite things.
  if (path === "/" && prefersHtml(req)) return sendHtml(res, hosakaLanding(cfg));
  if (path === "/" || path === "/index.json") return send(res, 200, card(cfg));

  const shelf = SHELVES.find((s) => s.route.path === path);
  if (!shelf) {
    return send(res, 404, {
      error: "not found",
      endpoints: SHELVES.map((s) => `${s.route.method} ${s.route.path}`).concat(
        "GET /",
        "GET /health",
        "GET /facilitator",
        "GET /warehouse",
      ),
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

/**
 * Proves the facilitator accepts our credentials without moving money.
 *
 * Worth a route of its own: a wrong key otherwise stays invisible until a buyer
 * tries to pay, and the first person to discover it is a customer.
 */
async function facilitatorStatus(
  cfg: Config,
  facilitator: FacilitatorClient | FacilitatorFor,
): Promise<[number, unknown]> {
  const route = (n: string) => (typeof facilitator === "function" ? facilitator(n) : facilitator);

  // Every chain the shop advertises, not just the primary one. A second chain
  // settled by a facilitator that does not support it is an offer no buyer can
  // complete, and without this it looks healthy right up until someone pays.
  const networks = [cfg.network.caip2, ...(cfg.algorandPayTo ? [ALGORAND_MAINNET] : []), ...cfg.rails.map((r) => r.caip2)];

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
          ...(canSettle ? {} : { problem: `cannot settle exact on ${network}` }),
        };
      } catch (err) {
        const status = err instanceof FacilitatorError ? err.status : null;
        const authProblem = status === 401 || status === 403;
        return {
          network,
          facilitator: client.baseUrl,
          reachable: !authProblem,
          authenticated: false,
          canSettle: false,
          problem: authProblem
            ? "the facilitator rejected our credentials — set CDP_API_KEY_ID and CDP_API_KEY_SECRET on this project"
            : err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const healthy = chains.every((c) => c.canSettle);
  return [healthy ? 200 : 503, { scheme: "exact", healthy, chains }];
}

function card(cfg: Config) {
  return {
    service: "Hosaka",
    description: "Company facts for agents. Pay per call in USDC, no signup, no API key.",
    source: "https://github.com/plus8bit/deadchannel",
    payment: {
      protocol: "x402",
      version: 2,
      network: cfg.network.label,
      networkId: cfg.network.caip2,
      payTo: cfg.payTo,
    },
    endpoints: Object.fromEntries(
      SHELVES.map((s) => [
        `${s.route.method} ${s.route.path}`,
        { price: `$${s.priceUsd} USDC`, input: s.route.inputExample, description: s.route.description },
      ]),
    ),
    note: "You are only charged when the call produces a result. Failures settle nothing.",
  };
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

async function main(): Promise<void> {
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(78);
    }
    throw err;
  }
  const facilitator = facilitatorsFor(cfg);
  createServer(createHandler(cfg, facilitator)).listen(cfg.port, () => {
    log("info", { msg: "hosaka listening", port: cfg.port, network: cfg.network.label, payTo: cfg.payTo });
  });
}

if (import.meta.filename === process.argv[1]) {
  await main();
}

/** Prefers HTML only when the client asked for it ahead of JSON, as browsers do. */
function prefersHtml(req: IncomingMessage): boolean {
  const accept = req.headers["accept"] ?? "";
  const value = Array.isArray(accept) ? accept.join(",") : accept;
  if (!value.includes("text/html")) return false;
  const html = value.indexOf("text/html");
  const json = value.indexOf("application/json");
  return json === -1 || html < json;
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=300",
    // Without this a CDN caches the page against the bare URL and later serves
    // it to an agent that asked for JSON.
    vary: "accept",
  });
  res.end(body);
}
