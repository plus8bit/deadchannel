#!/usr/bin/env node

// src/hosaka/sources/web.ts
var MAX_BYTES = 400 * 1024;

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

// src/server/paid.ts
var MAX_BODY_BYTES = 32 * 1024;

// src/hosaka/server/routes.ts
var PRICE_LOOKUP = 5e-3;
var PRICE_DOSSIER = 0.04;
var TTL_MS = 24 * 60 * 60 * 1e3;
var warehouse = new MemoryStore({ maxItems: 5e3 });

// src/hosaka/suppliers/buy.ts
var BASE_RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

// src/hosaka/server/bundle.ts
var TIERS = {
  executives: {
    supplier: "fullenrich-people",
    kind: "decision-makers",
    /**
     * The seniority levels a B2B buyer is actually looking for.
     *
     * The supplier accepts nine, and the two omitted — Manager and Senior —
     * describe people who carry out a decision rather than make one. The list
     * came from the supplier's own validator: sending an invalid value made it
     * enumerate every option it accepts, for nothing.
     */
    seniority: ["Owner", "Founder", "C-level", "Partner", "VP", "Head", "Director"],
    /**
     * $0.21 against the same $0.15 cost as the unfiltered shelf.
     *
     * The purchase price does not change, so the premium is not for more data —
     * it is for less of it, chosen. A list of everyone at a company and a list
     * of the seven people who can sign are not the same product, and the second
     * is the one anyone selling B2B came for.
     */
    priceUsd: 0.21
  },
  people: {
    supplier: "fullenrich-people",
    kind: "named-people",
    /**
     * $0.19 against a $0.16 ceiling on the supplier.
     *
     * The old price was set against a $0.28 competitor that no longer sets it.
     * Our own supplier is listed in the same catalog at $0.15 and ranks first
     * for the query this shelf answers, while we did not appear at all: selling
     * a marked-up copy above the original, on the shelf where the original
     * sits, is not a position an agent will ever choose.
     *
     * What survives that comparison is the pairing rather than the contacts —
     * the proven vendor stack and the people in a single call — so it is priced
     * to cost no more than buying the two halves apart, and wins on being one
     * call whose answer is already sorted.
     */
    priceUsd: 0.19
  },
  contacts: {
    supplier: "openwebninja-contacts",
    kind: "published-contact-points",
    /**
     * $0.02 against a $0.003 supplier cost.
     *
     * Cheap because the underlying answer is cheap: it is what the company
     * publishes about itself, not who works there. Priced as the shelf a buyer
     * reaches for when the question is "how do I reach this company" and the
     * people shelf would be waste.
     */
    priceUsd: 0.02
  }
};
var PRICE_BUNDLE = TIERS.people.priceUsd;
var PRICE_CONTACTS = TIERS.contacts.priceUsd;
var PRICE_EXECUTIVES = TIERS.executives.priceUsd;

// src/mcp/protocol.ts
var PROTOCOL_VERSION = "2025-06-18";
var McpServer = class {
  #info;
  #tools = /* @__PURE__ */ new Map();
  constructor(info) {
    this.#info = info;
  }
  tool(def, handler) {
    this.#tools.set(def.name, { def, handler });
    return this;
  }
  /** Handles one request. Returns null for notifications, which take no reply. */
  async handle(request) {
    const { id, method, params } = request;
    const isNotification = id === void 0;
    try {
      switch (method) {
        case "initialize":
          return reply(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: this.#info.name, version: this.#info.version },
            ...this.#info.instructions ? { instructions: this.#info.instructions } : {}
          });
        case "notifications/initialized":
          return null;
        case "tools/list":
          return reply(id, { tools: [...this.#tools.values()].map((t) => t.def) });
        case "tools/call": {
          const name = String(params?.["name"] ?? "");
          const entry = this.#tools.get(name);
          if (!entry) return error(id, -32602, `unknown tool: ${name}`);
          const args = params?.["arguments"] ?? {};
          return reply(id, await entry.handler(args));
        }
        case "ping":
          return reply(id, {});
        default:
          return isNotification ? null : error(id, -32601, `method not found: ${method}`);
      }
    } catch (err) {
      if (isNotification) return null;
      return error(id, -32603, err instanceof Error ? err.message : String(err));
    }
  }
  /** Reads newline-delimited JSON-RPC from stdin and answers on stdout. */
  async serve(input = process.stdin, output = process.stdout) {
    let buffer = "";
    input.setEncoding("utf8");
    for await (const chunk of input) {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;
        let request;
        try {
          request = JSON.parse(line);
        } catch {
          output.write(`${JSON.stringify(error(null, -32700, "parse error"))}
`);
          continue;
        }
        const response = await this.handle(request);
        if (response !== null) output.write(`${JSON.stringify(response)}
`);
      }
    }
  }
};
function reply(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function error(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function text(value) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]
  };
}
function failure(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

// src/mcp/pay.ts
var KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
async function payFor(url, body, keyEnv) {
  const key = process.env[keyEnv];
  if (!key) {
    throw new Error(
      `${keyEnv} is not set. Point it at a wallet holding a little USDC on Base \u2014 the key never leaves this machine; only a signature is sent.`
    );
  }
  if (!KEY_PATTERN.test(key.trim())) {
    throw new Error(`${keyEnv} must be a 0x-prefixed 32-byte hex key.`);
  }
  const [{ privateKeyToAccount }, { ExactEvmScheme }, { wrapFetchWithPayment, x402Client }] = await Promise.all([
    import("viem/accounts"),
    import("@x402/evm/exact/client"),
    import("@x402/fetch")
  ]).catch(() => {
    throw new Error("payment libraries are not installed: run `npm install` in this MCP's directory.");
  });
  const account = privateKeyToAccount(key.trim());
  const client = new x402Client().register("eip155:8453", new ExactEvmScheme(account));
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const res = await paidFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${url} returned ${res.status}. ${detail.slice(0, 300)}`);
  }
  return res.json();
}

// src/hosaka/mcp/server.ts
var BASE = process.env.HOSAKA_URL ?? "https://hosaka-agents.vercel.app";
var KEY_ENV = "HOSAKA_PRIVATE_KEY";
var usd = (n) => `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
var PRICES = {
  lookup: usd(PRICE_LOOKUP),
  dossier: usd(PRICE_DOSSIER),
  contacts: usd(TIERS.contacts.priceUsd),
  people: usd(TIERS.people.priceUsd),
  executives: usd(TIERS.executives.priceUsd)
};
var DOMAIN_SCHEMA = {
  type: "object",
  properties: {
    domain: {
      type: "string",
      description: "Company domain, for example figma.com. A URL or a www prefix is fine."
    }
  },
  required: ["domain"]
};
var server = new McpServer({
  name: "hosaka",
  version: "0.1.0",
  instructions: `Company facts from a domain, paid per call in USDC on Base. Five tools at five prices, so a cheap question does not pay for an expensive answer: hosaka_lookup is a ${PRICES.lookup} summary; hosaka_dossier (${PRICES.dossier}) returns every third-party vendor the company can be proven to use, each with the DNS record or script that proves it; hosaka_contacts (${PRICES.contacts}) adds the addresses and phone numbers the company publishes about itself; hosaka_people (${PRICES.people}) adds named individuals who work there; hosaka_executives (${PRICES.executives}) narrows those to the people who can sign. Requires ${KEY_ENV}, a wallet holding a little USDC.`
});
function domainOf(args) {
  const domain = args["domain"];
  if (typeof domain !== "string" || domain.trim().length === 0) {
    throw new Error('`domain` is required, for example {"domain": "figma.com"}');
  }
  return domain.trim();
}
server.tool(
  {
    name: "hosaka_lookup",
    title: "Look up a company",
    description: `Fast facts about a company from its domain: how old the domain is, its registrar, mail and DNS providers, whether DMARC and HTTPS are configured, and how many third-party vendors are visible. Costs ${PRICES.lookup} in USDC.`,
    inputSchema: DOMAIN_SCHEMA
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/lookup`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  }
);
server.tool(
  {
    name: "hosaka_dossier",
    title: "Full company dossier",
    description: `Everything hosaka_lookup returns, plus every third-party vendor the company can be proven to use \u2014 CRM, email, analytics, cloud, HR, payments \u2014 each with the DNS record, SPF include or loaded script that proves it. Also returns raw DNS, registration, certificate and site facts. Costs ${PRICES.dossier} in USDC.`,
    inputSchema: DOMAIN_SCHEMA
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/dossier`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  }
);
server.tool(
  {
    name: "hosaka_contacts",
    title: "How to reach a company",
    description: `Everything hosaka_dossier returns, plus every contact point the company publishes about itself \u2014 support and sales email addresses, phone numbers and social accounts, read from its own site. Use this when the question is how to reach the company. For named individuals who work there, use hosaka_people instead. Costs ${PRICES.contacts} in USDC.`,
    inputSchema: DOMAIN_SCHEMA
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/contacts`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  }
);
server.tool(
  {
    name: "hosaka_executives",
    title: "Who can sign at a company",
    description: `Finds the decision makers at a company from its domain alone: owners, founders, C-level, partners, VPs, heads and directors, each with title, location and profile link, plus everything hosaka_dossier returns. Reach for it when the question is who to approach about buying something. Use hosaka_people to see anyone who works there regardless of level. Costs ${PRICES.executives} in USDC.`,
    inputSchema: DOMAIN_SCHEMA
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/executives`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  }
);
server.tool(
  {
    name: "hosaka_people",
    title: "People who work at a company",
    description: `Finds the people who work at a company from its domain alone: named employees with job title, seniority, location and profile link, plus everything hosaka_dossier returns. Reach for it when the domain is all you have, because most people-data tools want an email or a profile URL first. Use hosaka_contacts instead when a published support address would answer. Costs ${PRICES.people} in USDC.`,
    inputSchema: DOMAIN_SCHEMA
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/people`, { domain: domainOf(args) }, KEY_ENV));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  }
);
await server.serve();
