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
                schema: { type: "object" },
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
      "x-guidance":
        "Every endpoint takes a JSON body with one field: {\"domain\": \"figma.com\"}. A URL works too; " +
        "the scheme and path are stripped. Start with POST /lookup ($0.01) for a summary, POST /dossier " +
        "($0.07) for every vendor with the DNS record or loaded script that proves it, POST /contacts " +
        "($0.02) for the addresses a company publishes about itself, POST /people ($0.25) for named " +
        "employees, and POST /executives ($0.30) for only those who can sign. Payment is x402 v2: call " +
        "without a payment header, read the terms from the 402, sign, retry. Settles in USDC on Base, " +
        "Solana, Polygon, Arbitrum, Algorand and Monad, and in USDG on Robinhood Chain — a buyer pays " +
        "on whichever chain it already holds a dollar. Nothing settles unless the answer is produced.",
      contact: { email: "dreamquayco@gmail.com" },
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: cfg.publicUrl }],
    paths,
  };
}
