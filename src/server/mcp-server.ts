#!/usr/bin/env node
import { PROBE_ROUTE } from "./routes.ts";
import { DEFAULT_PRICE_USD } from "./config.ts";
import { McpServer, failure, text } from "../mcp/protocol.ts";
import { payFor } from "../mcp/pay.ts";

/**
 * deadchannel as an MCP tool, so an agent can check a seller before paying it.
 *
 * The catalog is the wrong channel for this one. An agent searching the Bazaar
 * for a risk check has already decided to look for it; the agent that needs it
 * most is the one about to pay a stranger without having thought to look. A
 * tool sits in the surface where that decision is actually made — the client
 * already lists it, so the model can reach for it unprompted.
 *
 * The check itself costs a tenth of a cent, which is less than the smallest
 * payment it protects. That ratio is the whole argument: an agent that probes
 * before every unfamiliar purchase spends a rounding error to avoid a loss.
 *
 * The buyer brings their own wallet. DEADCHANNEL_PRIVATE_KEY signs the payment
 * and never leaves the machine; only a signature is sent.
 */

const BASE = process.env.DEADCHANNEL_URL ?? "https://deadchannel.vercel.app";
const KEY_ENV = "DEADCHANNEL_PRIVATE_KEY";
const PRICE = `$${DEFAULT_PRICE_USD}`;

const server = new McpServer({
  name: "deadchannel",
  version: "0.1.0",
  instructions:
    `Risk check for x402 endpoints, ${PRICE} per call in USDC on Base. Call deadchannel_probe ` +
    "before paying any endpoint you have not used before: it returns a verdict — live, degraded, " +
    "trap, testnet or dead — a 0-100 risk score, and the specific findings behind both, so a bad " +
    "endpoint can be declined instead of discovered by losing money. deadchannel_health takes no " +
    `payment and reports whether the service itself is up. Probing requires ${KEY_ENV}, a wallet ` +
    "holding a little USDC; the health check does not.",
});

server.tool(
  {
    name: "deadchannel_probe",
    title: "Check an x402 endpoint before paying it",
    description:
      "Grades an x402 endpoint you are considering paying. Returns a verdict (live, degraded, trap, " +
      "testnet, dead), a 0-100 risk score, the price it actually challenges for, the networks it " +
      "settles on, and the specific problems found — a testnet address advertised as mainnet, a " +
      "price that no longer matches its listing, a challenge that never settles. Use it whenever the " +
      "seller is unfamiliar, especially when the payment is larger than a few cents. " +
      `Costs ${PRICE} in USDC, which is less than the smallest payment it protects.`,
    inputSchema: PROBE_ROUTE.inputSchema,
  },
  async (args) => {
    const url = args["url"];
    if (typeof url !== "string" || url.trim().length === 0) {
      return failure('`url` is required, for example {"url": "https://api.example.com/paid"}');
    }
    return text(await payFor(`${BASE}${PROBE_ROUTE.path}`, { url: url.trim() }, KEY_ENV));
  },
);

server.tool(
  {
    name: "deadchannel_health",
    title: "Is deadchannel itself up",
    description:
      "Reports whether the risk checker is running and able to settle payments. Free, and needs no " +
      "wallet — use it to tell 'the service is down' apart from 'my key is wrong' before probing.",
    inputSchema: { type: "object", properties: {} },
  },
  async () => {
    const res = await fetch(`${BASE}/health`);
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return text({ ok: res.ok, status: res.status, ...(body ?? {}) });
  },
);

await server.serve();
