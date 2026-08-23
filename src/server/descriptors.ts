import type { Config } from "./config.ts";
import { PROBE_ROUTE } from "./routes.ts";

/**
 * Machine-readable descriptions of the service, in the two formats crawlers
 * actually ask for.
 *
 * Not speculative: the access log shows agent-readiness crawlers requesting
 * `/llms.txt` and `/openapi.json` and getting 404. Discovery is the bottleneck
 * this whole product is about, so failing our own discoverability checks would
 * be a poor look.
 */

/** llms.txt — a short markdown brief an LLM can read before deciding to call us. */
export function llmsTxt(cfg: Config): string {
  const url = `${cfg.publicUrl}${PROBE_ROUTE.path}`;
  const chains = cfg.algorandPayTo ? `${cfg.network.label} and Algorand` : cfg.network.label;
  return `# deadchannel & Hosaka

> Two services that sell to AI agents over x402, paid per call in USDC.
> deadchannel is a risk check for any x402 endpoint: a verdict, a 0-100 risk
> score and the specific problems found, so an agent can decide whether an
> endpoint is safe to call before it spends money finding out.
> Hosaka sells company facts from a domain: every third-party vendor a company
> can be proven to use, each with the DNS record or loaded script that proves
> it, plus the contact points it publishes and the people who work there.

Payment is x402 v2: send the request, get a 402 carrying the price, sign, retry.
No signup, no API key, no subscription. Settles on ${chains}, so a buyer pays on
whichever chain it already holds USDC.
You are charged only when the call produces a result; a failure settles nothing.

## Hosaka — company data (https://hosaka-agents.vercel.app)

- POST /lookup — $0.01 — domain age, registrar, mail and DNS provider, DMARC, HTTPS, vendor count
- POST /contacts — $0.02 — the dossier, plus the emails and phones the company publishes
- POST /dossier — $0.07 — every provable vendor, each with its evidence
- POST /people — $0.25 — the dossier, plus named people who work there

Body for all four: \`{"domain": "figma.com"}\`. Asking for figma.com returns
Anthropic, OpenAI, Adobe, Atlassian, MongoDB Atlas, Greenhouse, Docusign,
Stripe, Notion, Dropbox and Zendesk, each with the record that proves it.

Also available as an MCP server: \`npx -y hosaka-mcp\`

## deadchannel — endpoint risk check (${cfg.publicUrl})

- [POST ${PROBE_ROUTE.path}](${url}): ${cfg.priceUsd} USD in USDC. The check. Body: \`{"url": "<x402 resource to check>", "method": "<optional verb>", "samples": <1-5>}\`

## Verdicts

- \`live\` — gated, priced sanely, settles on mainnet
- \`degraded\` — callable, with problems worth weighing
- \`trap\` — will actively cost the caller money or funds
- \`testnet\` — works, but cannot accept real value
- \`dead\` — unreachable, bot-walled, or serving no payment requirements
- \`unknown\` — reachable, but not an x402 resource

## Free endpoints

- [GET /](${cfg.publicUrl}/): service card as JSON, landing page as HTML
- [GET /health](${cfg.publicUrl}/health): liveness
- [GET /facilitator](${cfg.publicUrl}/facilitator): proves our credentials are accepted, moves no money
- [GET /openapi.json](${cfg.publicUrl}/openapi.json): full schema

## Limits

Every verdict comes from the unpaid 402 an endpoint already returns. We never pay
the endpoints we grade, so we can tell you whether one is safe to try, not whether
its output is any good.

## Source

- [github.com/plus8bit/deadchannel](https://github.com/plus8bit/deadchannel): open source, including the checks and their weights
`;
}

/** OpenAPI 3.1, including the 402 that carries the price. */
export function openApiSpec(cfg: Config): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "deadchannel",
      version: "1.0.0",
      description: PROBE_ROUTE.description,
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: cfg.publicUrl }],
    paths: {
      [PROBE_ROUTE.path]: {
        post: {
          operationId: "probeEndpoint",
          summary: "Check whether an x402 endpoint is safe to call",
          description: `Paid via x402 v2. An unpaid request returns 402 with a PAYMENT-REQUIRED header carrying the terms: ${cfg.priceUsd} USD in USDC on ${cfg.network.label}. Settlement runs only after the check produces a result.`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: PROBE_ROUTE.inputSchema,
                example: PROBE_ROUTE.inputExample,
              },
            },
          },
          responses: {
            "200": {
              description: "The check ran and the payment settled.",
              headers: {
                "PAYMENT-RESPONSE": {
                  description: "Base64 SettlementResponse, including the transaction hash.",
                  schema: { type: "string" },
                },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Verdict" },
                  example: PROBE_ROUTE.outputExample,
                },
              },
            },
            "400": { description: "The request body is not a valid target." },
            "402": {
              description: "Payment required, or the payment was rejected.",
              headers: {
                "PAYMENT-REQUIRED": {
                  description: "Base64 PaymentRequired object carrying price, network and payTo.",
                  schema: { type: "string" },
                },
              },
            },
            "502": { description: "The check failed. Nothing was settled, so you were not charged." },
          },
        },
      },
      "/health": { get: { operationId: "health", summary: "Liveness", responses: { "200": { description: "Alive." } } } },
      "/facilitator": {
        get: {
          operationId: "facilitatorStatus",
          summary: "Whether our facilitator credentials are accepted. Moves no money.",
          responses: { "200": { description: "Ready to settle." }, "503": { description: "Cannot settle." } },
        },
      },
    },
    components: {
      schemas: {
        Verdict: {
          type: "object",
          required: ["url", "verdict", "risk", "problems"],
          properties: {
            url: { type: "string" },
            verdict: {
              type: "string",
              enum: ["live", "degraded", "trap", "testnet", "dead", "unknown"],
            },
            risk: { type: "integer", minimum: 0, maximum: 100, description: "0 is safe to call, 100 is do not call." },
            priceUsd: { type: ["number", "null"] },
            networks: { type: "array", items: { type: "string" } },
            latencyMs: {
              type: ["object", "null"],
              properties: { p50: { type: "integer" }, p99: { type: "integer" } },
            },
            problems: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  status: { type: "string", enum: ["warn", "fail"] },
                  detail: { type: "string" },
                },
              },
            },
            checksPassed: { type: "integer" },
            checksRun: { type: "integer" },
            probedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    "x-x402": {
      version: 2,
      price: `${cfg.priceUsd} USD`,
      asset: cfg.network.usdc,
      network: cfg.network.caip2,
      payTo: cfg.payTo,
    },
  };
}
