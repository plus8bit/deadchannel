#!/usr/bin/env node

// src/hosaka/mcp/protocol.ts
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

// src/hosaka/mcp/pay.ts
var KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
async function payFor(url, body) {
  const key = process.env["HOSAKA_PRIVATE_KEY"];
  if (!key) {
    throw new Error(
      "HOSAKA_PRIVATE_KEY is not set. Point it at a wallet holding a little USDC on Base \u2014 the key never leaves this machine; only a signature is sent."
    );
  }
  if (!KEY_PATTERN.test(key.trim())) {
    throw new Error("HOSAKA_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key.");
  }
  const [{ privateKeyToAccount }, { ExactEvmScheme }, { wrapFetchWithPayment, x402Client }] = await Promise.all([
    import("viem/accounts"),
    import("@x402/evm/exact/client"),
    import("@x402/fetch")
  ]).catch(() => {
    throw new Error("payment libraries are not installed: run `npm install` in the hosaka MCP directory.");
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
  instructions: "Company facts from a domain, paid per call in USDC on Base. hosaka_lookup is a cheap summary; hosaka_dossier returns every third-party vendor the company can be proven to use, each with the DNS record or script that proves it. Requires HOSAKA_PRIVATE_KEY, a wallet holding a little USDC."
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
    description: "Fast facts about a company from its domain: how old the domain is, its registrar, mail and DNS providers, whether DMARC and HTTPS are configured, and how many third-party vendors are visible. Costs $0.005 in USDC.",
    inputSchema: DOMAIN_SCHEMA
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/lookup`, { domain: domainOf(args) }));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  }
);
server.tool(
  {
    name: "hosaka_dossier",
    title: "Full company dossier",
    description: "Everything hosaka_lookup returns, plus every third-party vendor the company can be proven to use \u2014 CRM, email, analytics, cloud, HR, payments \u2014 each with the DNS record, SPF include or loaded script that proves it. Also returns raw DNS, registration, certificate and site facts. Costs $0.05 in USDC.",
    inputSchema: DOMAIN_SCHEMA
  },
  async (args) => {
    try {
      return text(await payFor(`${BASE}/dossier`, { domain: domainOf(args) }));
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  }
);
await server.serve();
