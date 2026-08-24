import { SUPPLIERS, SupplierError } from "./types.ts";
import type { Purchase, Supplier } from "./types.ts";

/** Canonical USDC on Base, and a public node to read balances from. */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

/**
 * Buys one item from an x402 supplier using the operating wallet.
 *
 * Two rules shape this, both learned from measuring the market rather than
 * assumed:
 *
 * The price is read from the supplier's own 402 and checked against a ceiling
 * before anything is signed. An endpoint can reprice itself between one call
 * and the next, and a reseller that pays whatever it is quoted will eventually
 * pay more than it charged.
 *
 * The operating key is separate from the payout address on purpose. The payout
 * address never needs a key on a server — a seller only names it — so keeping
 * them apart means a compromised server loses a float, not the takings.
 */

const KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export interface BuyOptions {
  /** Overrides the operating key, for tests. */
  privateKey?: string;
  timeoutMs?: number;
}

export function operatingKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env["HOSAKA_OPERATING_KEY"];
  return key && KEY_PATTERN.test(key.trim()) ? key.trim() : null;
}

/** What a supplier's 402 says it will charge, without committing to pay it. */
export async function quote(supplier: Supplier, timeoutMs = 10_000): Promise<number> {
  const res = await fetch(supplier.url, {
    method: supplier.method,
    headers: { "content-type": "application/json", accept: "application/json" },
    ...(supplier.method === "POST" ? { body: "{}" } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status !== 402) {
    throw new SupplierError(supplier.id, `expected 402, got ${res.status}`);
  }
  const header = res.headers.get("payment-required");
  if (!header) throw new SupplierError(supplier.id, "402 carried no PAYMENT-REQUIRED header");

  const required = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
    accepts?: { network?: string; amount?: string; scheme?: string }[];
  };
  const onBase = (required.accepts ?? []).find(
    (a) => a.network === "eip155:8453" && a.scheme === "exact" && a.amount,
  );
  if (!onBase?.amount) throw new SupplierError(supplier.id, "no exact Base mainnet option offered");
  return Number(onBase.amount) / 1e6;
}

/**
 * Takes an id from the registry or a supplier outright. The second form keeps
 * tests from having to mutate the shared registry, which leaks between them.
 */
export async function buy<T>(
  which: string | Supplier,
  body: unknown,
  options: BuyOptions = {},
): Promise<Purchase<T>> {
  const supplier = typeof which === "string" ? SUPPLIERS[which] : which;
  if (!supplier) throw new SupplierError(String(which), "unknown supplier", false);

  const key = options.privateKey ?? operatingKey();
  if (!key) {
    throw new SupplierError(
      supplier.id,
      "HOSAKA_OPERATING_KEY is not set, so nothing can be bought. Fund a separate wallet for this; the payout address must never have its key on a server.",
      false,
    );
  }

  const asking = await quote(supplier, options.timeoutMs);
  if (asking > supplier.maxPriceUsd) {
    throw new SupplierError(
      supplier.id,
      `asking $${asking}, ceiling is $${supplier.maxPriceUsd}. Not bought.`,
      false,
    );
  }

  const { privateKeyToAccount } = await import("viem/accounts");
  const { ExactEvmScheme } = await import("@x402/evm/exact/client");
  const { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } = await import("@x402/fetch");

  const account = privateKeyToAccount(key as `0x${string}`);

  const float = await floatUsd(account.address, options.timeoutMs);
  if (float !== null && float < asking) {
    throw new SupplierError(
      supplier.id,
      `costs $${asking} but the operating wallet holds $${float.toFixed(3)}. Not bought; top it up.`,
      false,
    );
  }

  const client = new x402Client().register("eip155:8453", new ExactEvmScheme(account));
  const paidFetch = wrapFetchWithPayment(fetch, client);

  const res = await paidFetch(requestUrl(supplier, body), {
    method: supplier.method,
    headers: { "content-type": "application/json", accept: "application/json" },
    ...(supplier.method === "POST" ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Kept long on purpose. A supplier that rejects a request usually explains
    // what it wanted, and that explanation is the cheapest schema we will ever
    // get — one of them listed its own filter names in a rejection that cost
    // nothing. Truncating it at 200 characters threw away the answer.
    throw new SupplierError(supplier.id, `returned ${res.status}. ${detail.slice(0, 2000)}`);
  }

  const receipt = res.headers.get("payment-response");
  const settlement = receipt ? decodePaymentResponseHeader(receipt) : null;

  return {
    supplier: supplier.id,
    paidUsd: asking,
    transaction: settlement?.transaction ?? null,
    ...(supplier.byDomain?.unverified ? { unverifiedMapping: true } : {}),
    data: (await res.json()) as T,
  };
}

/**
 * Where the request parameters actually go.
 *
 * A GET endpoint has no body to carry them, so anything we built for it has to
 * ride in the query string or it never arrives. Sending a body to a GET
 * supplier looks like it works — the payment settles and a 200 comes back —
 * but the endpoint answers a question we never asked, and we have paid for it.
 */
export function requestUrl(supplier: Supplier, body: unknown): string {
  if (supplier.method !== "GET") return supplier.url;
  const url = new URL(supplier.url);
  for (const [k, v] of Object.entries((body ?? {}) as Record<string, unknown>)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * What the operating wallet can actually spend, in USD.
 *
 * Checked before paying rather than after failing. A reseller that discovers it
 * is broke halfway through an order has already taken the buyer's money and
 * still has nothing to hand back; discovering it one call earlier turns that
 * into a refusal the buyer can act on.
 *
 * Returns null if the balance cannot be read, which is deliberately not the
 * same as zero — an unreachable RPC must not block a sale the wallet could
 * have paid for. The purchase then fails the old way, which is no worse than
 * before this check existed.
 */
export async function floatUsd(address: string, timeoutMs = 10_000): Promise<number | null> {
  const call = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [
      { to: USDC_BASE, data: `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` },
      "latest",
    ],
  };
  try {
    const res = await fetch(BASE_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(call),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string };
    if (!json.result) return null;
    return Number(BigInt(json.result)) / 1e6;
  } catch {
    return null;
  }
}
