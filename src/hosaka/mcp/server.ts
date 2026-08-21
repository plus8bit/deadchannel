#!/usr/bin/env node
import { McpServer, failure, text } from "./protocol.ts";
import { payFor } from "./pay.ts";

/**
 * Hosaka as an MCP tool, so an agent inside Claude or ChatGPT can buy company
 * facts without knowing what x402 is.
 *
 * The catalog's search ignores the query and ranks purely by unique payers, so
 * a new shop is invisible there no matter how good it is. MCP is the channel
 * that works on day one: the agent is already in a client that speaks it.
 *
 * The buyer brings their own wallet. HOSAKA_PRIVATE_KEY signs the payment and
 * is read once at startup; without it the tools explain what is missing rather
 * than failing obscurely mid-conversation.
 */

const BASE = process.env.HOSAKA_URL ?? "https://hosaka-agents.vercel.app";

const DOMAIN_SCHEMA = {
  type: "object",
  properties: {
    domain: {
      type: "string",
      description: "Company domain, for example figma.com. A URL or a www prefix is fine.",
    },
  },
  required: ["domain"],
} as const;

const server = new McpServer({
  name: "hosaka",
  version: "0.1.0",
  instructions:
    "Company facts from a domain, paid per call in USDC on Base. hosaka_lookup is a cheap summary; " +
    "hosaka_dossier returns every third-party vendor the company can be proven to use, each with the " +
    "DNS record or script that proves it. Requires HOSAKA_PRIVATE_KEY, a wallet holding a little USDC.",
});

function domainOf(args: Record<string, unknown>): string {
  const domain = args["domain"];
  if (typeof domain !== "string" || domain.trim().length === 0) {
    throw new Error("`domain` is required, for example {\"domain\": \"figma.com\"}");
  }
  return domain.trim();
}

server.tool(
  {
    name: "hosaka_lookup",
    title: "Look up a company",
    description:
      "Fast facts about a company from its domain: how old the domain is, its registrar, mail and DNS " +
      "providers, whether DMARC and HTTPS are configured, and how many third-party vendors are visible. " +
      "Costs $0.005 in USDC.",
    inputSchema: DOMAIN_SCHEMA,
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/lookup`, { domain: domainOf(args) }));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  },
);

server.tool(
  {
    name: "hosaka_dossier",
    title: "Full company dossier",
    description:
      "Everything hosaka_lookup returns, plus every third-party vendor the company can be proven to use " +
      "— CRM, email, analytics, cloud, HR, payments — each with the DNS record, SPF include or loaded " +
      "script that proves it. Also returns raw DNS, registration, certificate and site facts. " +
      "Costs $0.05 in USDC.",
    inputSchema: DOMAIN_SCHEMA,
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/dossier`, { domain: domainOf(args) }));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  },
);

await server.serve();
