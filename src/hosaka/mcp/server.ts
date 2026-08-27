#!/usr/bin/env node
import { PRICE_LOOKUP, PRICE_DOSSIER } from "../server/routes.ts";
import { TIERS } from "../server/bundle.ts";
import { McpServer, failure, text } from "../../mcp/protocol.ts";
import { payFor } from "../../mcp/pay.ts";

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
const KEY_ENV = "HOSAKA_PRIVATE_KEY";

/**
 * Prices are read from the same constants that build the 402, never typed into
 * prose. A tool description that quotes a price we no longer charge sends an
 * agent to budget for one number and be challenged for another.
 */
const usd = (n: number) => `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
const PRICES = {
  lookup: usd(PRICE_LOOKUP),
  dossier: usd(PRICE_DOSSIER),
  contacts: usd(TIERS.contacts.priceUsd),
  people: usd(TIERS.people.priceUsd),
  executives: usd(TIERS.executives.priceUsd),
};

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
    "Company facts from a domain, paid per call in USDC on Base. Five tools at five prices, so a " +
    `cheap question does not pay for an expensive answer: hosaka_lookup is a ${PRICES.lookup} summary; ` +
    `hosaka_dossier (${PRICES.dossier}) returns every third-party vendor the company can be proven to ` +
    `use, each with the DNS record or script that proves it; hosaka_contacts (${PRICES.contacts}) adds ` +
    `the addresses and phone numbers the company publishes about itself; hosaka_people ` +
    `(${PRICES.people}) adds named individuals who work there; hosaka_executives ` +
    `(${PRICES.executives}) narrows those to the people who can sign. Requires ${KEY_ENV}, a wallet ` +
    "holding a little USDC.",
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
      `Costs ${PRICES.lookup} in USDC.`,
    inputSchema: DOMAIN_SCHEMA,
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/lookup`, { domain: domainOf(args) }, KEY_ENV));
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
      `Costs ${PRICES.dossier} in USDC.`,
    inputSchema: DOMAIN_SCHEMA,
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/dossier`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  },
);

server.tool(
  {
    name: "hosaka_contacts",
    title: "How to reach a company",
    description:
      "Everything hosaka_dossier returns, plus every contact point the company publishes about itself " +
      "— support and sales email addresses, phone numbers and social accounts, read from its own site. " +
      "Use this when the question is how to reach the company. For named individuals who work there, " +
      `use hosaka_people instead. Costs ${PRICES.contacts} in USDC.`,
    inputSchema: DOMAIN_SCHEMA,
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/contacts`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  },
);

server.tool(
  {
    name: "hosaka_executives",
    title: "Who can sign at a company",
    description:
      "Finds the decision makers at a company from its domain alone: owners, founders, C-level, " +
      "partners, VPs, heads and directors, each with title, location and profile link, plus everything " +
      "hosaka_dossier returns. Reach for it when the question is who to approach about buying something. " +
      `Use hosaka_people to see anyone who works there regardless of level. Costs ${PRICES.executives} in USDC.`,
    inputSchema: DOMAIN_SCHEMA,
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/executives`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  },
);

server.tool(
  {
    name: "hosaka_people",
    title: "People who work at a company",
    description:
      "Finds the people who work at a company from its domain alone: named employees with job title, " +
      "seniority, location and profile link, plus everything hosaka_dossier returns. Reach for it when " +
      "the domain is all you have, because most people-data tools want an email or a profile URL first. " +
      `Use hosaka_contacts instead when a published support address would answer. Costs ${PRICES.people} in USDC.`,
    inputSchema: DOMAIN_SCHEMA,
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/people`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  },
);

await server.serve();
