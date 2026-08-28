import type { Config } from "../../server/config.ts";
import type { PaidRoute } from "../../server/x402.ts";

/** Only the parts of a shelf a contract needs: what it is and what it costs. */
interface Listing {
  route: PaidRoute;
  priceUsd?: number | undefined;
}

/**
 * The machine-readable contract agents and registries read first.
 *
 * x402scan — the ecosystem explorer that indexes buyers, merchants and
 * resources across chains — treats OpenAPI at /openapi.json as the canonical
 * discovery format and the runtime 402 as the final source of truth. When the
 * two disagree, agents fail on their first attempt and move on; when they
 * agree, a resource is not merely listed but reliably invocable.
 *
 * So this is generated from the same route table and the same prices that build
 * the 402, rather than written alongside them. Two hand-maintained descriptions
 * of one price is a promise waiting to drift.
 */
/**
 * Turns the published example into a JSON Schema describing the same shape.
 *
 * Derived rather than written, because a hand-kept schema is a second
 * description of one answer and the two drift. The example is already checked
 * against what the endpoint returns, so a schema built from it inherits that
 * check. Agents need the field names and their types before paying; that is
 * exactly what an example carries.
 */
function schemaFrom(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { type: "array", items: value.length > 0 ? schemaFrom(value[0]) : { type: "object" } };
  }
  if (value === null) return { type: ["string", "null"] };
  if (typeof value === "object") {
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) properties[k] = schemaFrom(v);
    return { type: "object", properties };
  }
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
}

/** Prints a price the way a reader writes one, trailing zeros trimmed. */
const usd = (n: number) => `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;

/** The live price of one shelf, so prose and challenge cannot disagree. */
function shelfPrice(shelves: readonly Listing[], path: string, cfg: Config): number {
  const shelf = shelves.find((s) => s.route.path === path);
  return shelf?.priceUsd ?? cfg.priceUsd;
}

export function hosakaOpenApi(
  cfg: Config,
  shelves: readonly Listing[],
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const shelf of shelves) {
    const price = shelf.priceUsd ?? cfg.priceUsd;
    paths[shelf.route.path] = {
      post: {
        operationId: shelf.route.path.replace(/^\//, ""),
        summary: shelf.route.description,
        tags: shelf.route.tags.slice(0, 4),
        // Decimal USD here; the 402 carries the same number in atomic units.
        "x-payment-info": {
          price: { mode: "fixed", currency: "USD", amount: price.toFixed(6) },
          protocols: [{ x402: {} }],
        },
        requestBody: {
          required: true,
          content: { "application/json": { schema: shelf.route.inputSchema } },
        },
        responses: {
          "200": {
            description: "The answer.",
            content: {
              "application/json": {
                schema: schemaFrom(shelf.route.outputExample),
                example: shelf.route.outputExample,
              },
            },
          },
          "402": {
            description:
              "Payment required. The PAYMENT-REQUIRED header carries the price and terms on every supported chain.",
          },
          "400": { description: "The body was not a usable domain." },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Hosaka",
      version: "1.0.0",
      description:
        "Company data for AI agents, paid per call in USDC. Reads a company's own DNS to find every " +
        "third-party vendor it can be proven to use, and returns the record proving each one.",
      // Generated from the same prices, never written out. Typed by hand, this
      // sentence went on promising $0.01, $0.07, $0.02, $0.25 and $0.30 through
      // three repricings while the challenge asked four times more — which is
      // precisely the mismatch our own risk checker exists to flag on others.
      "x-guidance":
        'Every endpoint takes a JSON body with one field: {"domain": "figma.com"}. A URL works too; ' +
        "the scheme and path are stripped. Start with POST /lookup (" +
        usd(shelfPrice(shelves, "/lookup", cfg)) +
        ") for a summary, POST /dossier (" +
        usd(shelfPrice(shelves, "/dossier", cfg)) +
        ") for every vendor with the DNS record or loaded script that proves it, POST /contacts (" +
        usd(shelfPrice(shelves, "/contacts", cfg)) +
        ") for the addresses a company publishes about itself, POST /people (" +
        usd(shelfPrice(shelves, "/people", cfg)) +
        ") for named employees, and POST /executives (" +
        usd(shelfPrice(shelves, "/executives", cfg)) +
        ") for only those who can sign. Payment is x402 v2: call without a payment header, read the " +
        "terms from the 402, sign, retry. Settles in USDC on Base, Solana, Polygon, Arbitrum, Algorand " +
        "and Monad, and in USDG on Robinhood Chain, so a buyer pays on whichever chain it already " +
        "holds a dollar. Nothing settles unless the answer is produced.",
      contact: { email: "dreamquayco@gmail.com" },
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: cfg.publicUrl }],
    paths,
  };
}

/**
 * The plain-text card an agent reads before it reads anything structured.
 *
 * Built from the same shelf table as the OpenAPI, so the two cannot drift and
 * neither can drift from the challenge.
 */
export function hosakaLlmsTxt(cfg: Config, shelves: readonly Listing[]): string {
  const rows = shelves
    .map((s) => `- \`POST ${s.route.path}\` ${usd(s.priceUsd ?? cfg.priceUsd)} — ${s.route.description}`)
    .join("\n");
  return `# Hosaka

Company data for AI agents, paid per call in USDC. Reads a company's own DNS to
find every third-party vendor it can be proven to use, and returns the record
proving each one. No signup, no API key, no subscription.

## Endpoints

Every paid endpoint takes \`{"domain": "figma.com"}\`. A URL works too.

${rows}
- \`POST /preview\` free — vendor count and a sample, to see the shape before paying

## Paying

x402 v2. Call without a payment header, read the terms from the 402, sign, retry.
Settles in USDC on Base, Solana, Polygon, Arbitrum, Algorand and Monad, and in
USDG on Robinhood Chain. Nothing settles unless the answer is produced.

## Elsewhere

- MCP server: \`npm i -g hosaka-mcp\` (io.github.plus8bit/hosaka)
- OpenAPI: ${cfg.publicUrl}/openapi.json
- Source: https://github.com/plus8bit/deadchannel
`;
}
