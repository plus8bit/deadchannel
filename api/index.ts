import type { IncomingMessage, ServerResponse } from "node:http";
import { createHandler } from "../src/server/app.ts";
import { ConfigError, loadConfig } from "../src/server/config.ts";
import { FacilitatorClient } from "../src/server/facilitator.ts";

/**
 * Serverless entry point.
 *
 * Config is resolved once per cold start and cached. A misconfigured deployment
 * answers 503 with the exact problems rather than serving a broken paywall that
 * takes money and sends it nowhere.
 */

let handler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
let configProblems: string[] | null = null;

try {
  const cfg = loadConfig();
  handler = createHandler(cfg, new FacilitatorClient(cfg.facilitatorUrl, cfg.facilitatorToken));
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
