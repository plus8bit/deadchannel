import type { IncomingMessage, ServerResponse } from "node:http";
import { createHandler } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { FacilitatorClient } from "./facilitator.ts";
import { facilitatorAuth } from "./facilitator-auth.ts";

/**
 * Serverless entry point.
 *
 * Bundled to `api/index.mjs` by the build step rather than shipped as source:
 * Vercel transpiles `api/*.ts` but does not bundle, leaving `.ts` import
 * specifiers in place that Node cannot resolve at runtime.
 *
 * Config is resolved once per cold start and cached. A misconfigured deployment
 * answers 503 with the exact problems rather than serving a broken paywall that
 * takes money and sends it nowhere.
 */

let handler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
let configProblems: string[] | null = null;

try {
  const cfg = loadConfig();
  handler = createHandler(cfg, new FacilitatorClient(cfg.facilitatorUrl, facilitatorAuth(cfg)));
} catch (err) {
  configProblems = err instanceof ConfigError ? err.problems : [String(err)];
}

export default function (req: IncomingMessage, res: ServerResponse): void {
  if (!handler) {
    const body = JSON.stringify({ error: "service misconfigured", problems: configProblems }, null, 2);
    res.writeHead(503, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  handler(req, res);
}
