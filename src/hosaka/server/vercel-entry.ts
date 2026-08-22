import type { IncomingMessage, ServerResponse } from "node:http";
import hosakaDefaults from "../../../hosaka/hosaka.config.json" with { type: "json" };
import { ConfigError, loadConfig } from "../../server/config.ts";
import { facilitatorsFor } from "../../server/facilitator-router.ts";
import { createHandler } from "./app.ts";

/**
 * Serverless entry point for Hosaka.
 *
 * Config resolves once per cold start. A misconfigured deployment answers 503
 * with the exact problems rather than serving a paywall that takes money and
 * sends it nowhere.
 *
 * Hosaka's own settings are imported explicitly: the bundler inlines whatever
 * config a module imports, so without this the shop would advertise
 * deadchannel's URL and the catalog would index the wrong endpoint.
 */

let handler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
let problems: string[] | null = null;

try {
  const cfg = loadConfig(process.env, hosakaDefaults);
  handler = createHandler(cfg, facilitatorsFor(cfg));
} catch (err) {
  problems = err instanceof ConfigError ? err.problems : [String(err)];
}

export default function (req: IncomingMessage, res: ServerResponse): void {
  if (!handler) {
    const body = JSON.stringify({ error: "service misconfigured", problems }, null, 2);
    res.writeHead(503, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  handler(req, res);
}
