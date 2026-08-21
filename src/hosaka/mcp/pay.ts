/**
 * Pays an x402 endpoint on the caller's behalf.
 *
 * Deliberately explicit about failure: an agent that cannot pay should be told
 * why in words its operator can act on, not handed a stack trace mid-answer.
 */

const KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export async function payFor(url: string, body: unknown): Promise<unknown> {
  const key = process.env["HOSAKA_PRIVATE_KEY"];
  if (!key) {
    throw new Error(
      "HOSAKA_PRIVATE_KEY is not set. Point it at a wallet holding a little USDC on Base — " +
        "the key never leaves this machine; only a signature is sent.",
    );
  }
  if (!KEY_PATTERN.test(key.trim())) {
    throw new Error("HOSAKA_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key.");
  }

  // Imported lazily so the server starts, and can explain itself, even when the
  // payment libraries are missing.
  const [{ privateKeyToAccount }, { ExactEvmScheme }, { wrapFetchWithPayment, x402Client }] =
    await Promise.all([
      import("viem/accounts"),
      import("@x402/evm/exact/client"),
      import("@x402/fetch"),
    ]).catch(() => {
      throw new Error("payment libraries are not installed: run `npm install` in the hosaka MCP directory.");
    });

  const account = privateKeyToAccount(key.trim() as `0x${string}`);
  const client = new x402Client().register("eip155:8453", new ExactEvmScheme(account));
  const paidFetch = wrapFetchWithPayment(fetch, client);

  const res = await paidFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${url} returned ${res.status}. ${detail.slice(0, 300)}`);
  }
  return res.json();
}
