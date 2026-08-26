#!/usr/bin/env node

// src/probe/networks.ts
var CAIP2 = {
  "eip155:1": { name: "ethereum", testnet: false },
  "eip155:10": { name: "optimism", testnet: false },
  "eip155:56": { name: "bsc", testnet: false },
  "eip155:137": { name: "polygon", testnet: false },
  "eip155:8453": { name: "base", testnet: false },
  "eip155:84532": { name: "base-sepolia", testnet: true },
  "eip155:42161": { name: "arbitrum", testnet: false },
  "eip155:421614": { name: "arbitrum-sepolia", testnet: true },
  "eip155:43114": { name: "avalanche", testnet: false },
  "eip155:43113": { name: "avalanche-fuji", testnet: true },
  "eip155:1329": { name: "sei", testnet: false },
  "eip155:1328": { name: "sei-testnet", testnet: true },
  "eip155:4689": { name: "iotex", testnet: false },
  "eip155:196": { name: "x-layer", testnet: false },
  "eip155:143": { name: "monad", testnet: false },
  "eip155:4663": { name: "robinhood", testnet: false },
  "eip155:5000": { name: "mantle", testnet: false },
  "eip155:59144": { name: "linea", testnet: false },
  "eip155:100": { name: "gnosis", testnet: false },
  "eip155:2020": { name: "ronin", testnet: false },
  // CAIP-2 identifies a Solana cluster by the first 32 chars of its genesis hash.
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { name: "solana", testnet: false },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { name: "solana-devnet", testnet: true },
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": { name: "solana-testnet", testnet: true },
  // Algorand identifies a network by the base64 genesis hash. CAIP-2 caps a
  // reference at 32 characters, so the spec-shaped id is the hash truncated —
  // but the facilitator actually serving Algorand sends the full 44-character
  // hash, padding included. Both forms appear in the wild and both must
  // resolve; matching only the spec-shaped one left every Algorand endpoint
  // reading as an unknown network, which is 1126 of them.
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k": { name: "algorand", testnet: false },
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=": { name: "algorand", testnet: false },
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe": { name: "algorand-testnet", testnet: true },
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=": { name: "algorand-testnet", testnet: true }
};
var CAIP2_LOWER = Object.fromEntries(
  Object.entries(CAIP2).map(([k, v]) => [k.toLowerCase(), v])
);

// src/probe/observe.ts
var MAX_BODY_BYTES = 64 * 1024;

// src/server/routes.ts
var PROBE_ROUTE = {
  path: "/probe",
  method: "POST",
  serviceName: "deadchannel",
  description: "Use before paying an x402 endpoint you have not used before, when you cannot tell a working seller from a trap, a testnet address dressed as mainnet, or a listing whose price no longer matches its challenge. Returns a verdict \u2014 live, degraded, trap, testnet or dead \u2014 a 0-100 risk score, and the specific findings behind both, so an agent can decline a bad endpoint instead of learning about it by losing the money. Costs less than the smallest payment it protects.",
  tags: ["preflight", "payment-guard", "x402", "risk", "agent-safety"],
  mimeType: "application/json",
  inputExample: { url: "https://api.example.com/paid-endpoint" },
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The x402 resource URL to check" },
      method: { type: "string", description: "HTTP verb the resource expects, if known" },
      samples: { type: "number", description: "Probes to take, 1-5 (default 2)" }
    },
    required: ["url"]
  },
  outputExample: {
    url: "https://api.example.com/paid-endpoint",
    verdict: "degraded",
    risk: 25,
    priceUsd: 0.01,
    latencyMs: { p50: 180, p99: 240 },
    problems: [
      { id: "schema-advertised", status: "warn", detail: "No input or output schema." }
    ]
  }
};

// src/server/config.ts
var DEFAULT_PRICE_USD = 1e-3;

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

// src/server/mcp-server.ts
var BASE = process.env.DEADCHANNEL_URL ?? "https://deadchannel.vercel.app";
var KEY_ENV = "DEADCHANNEL_PRIVATE_KEY";
var PRICE = `$${DEFAULT_PRICE_USD}`;
var server = new McpServer({
  name: "deadchannel",
  version: "0.1.0",
  instructions: `Risk check for x402 endpoints, ${PRICE} per call in USDC on Base. Call deadchannel_probe before paying any endpoint you have not used before: it returns a verdict \u2014 live, degraded, trap, testnet or dead \u2014 a 0-100 risk score, and the specific findings behind both, so a bad endpoint can be declined instead of discovered by losing money. deadchannel_health takes no payment and reports whether the service itself is up. Probing requires ${KEY_ENV}, a wallet holding a little USDC; the health check does not.`
});
server.tool(
  {
    name: "deadchannel_probe",
    title: "Check an x402 endpoint before paying it",
    description: `Grades an x402 endpoint you are considering paying. Returns a verdict (live, degraded, trap, testnet, dead), a 0-100 risk score, the price it actually challenges for, the networks it settles on, and the specific problems found \u2014 a testnet address advertised as mainnet, a price that no longer matches its listing, a challenge that never settles. Use it whenever the seller is unfamiliar, especially when the payment is larger than a few cents. Costs ${PRICE} in USDC, which is less than the smallest payment it protects.`,
    inputSchema: PROBE_ROUTE.inputSchema
  },
  async (args) => {
    const url = args["url"];
    if (typeof url !== "string" || url.trim().length === 0) {
      return failure('`url` is required, for example {"url": "https://api.example.com/paid"}');
    }
    return text(await payFor(`${BASE}${PROBE_ROUTE.path}`, { url: url.trim() }, KEY_ENV));
  }
);
server.tool(
  {
    name: "deadchannel_health",
    title: "Is deadchannel itself up",
    description: "Reports whether the risk checker is running and able to settle payments. Free, and needs no wallet \u2014 use it to tell 'the service is down' apart from 'my key is wrong' before probing.",
    inputSchema: { type: "object", properties: {} }
  },
  async () => {
    const res = await fetch(`${BASE}/health`);
    const body = await res.json().catch(() => null);
    return text({ ok: res.ok, status: res.status, ...body ?? {} });
  }
);
await server.serve();
