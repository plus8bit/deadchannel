#!/usr/bin/env node
/**
 * Make the first real payment to this service, which is what puts it in the Bazaar.
 *
 * Facilitators index a resource when they observe a settled payment for it —
 * there is no registration endpoint. So the catalog listing is bootstrapped by
 * buying from yourself once, for the price of the call plus gas.
 *
 * The signing key is read from BUYER_PRIVATE_KEY and never printed, stored or
 * sent anywhere except the local signer. Run this yourself; nobody else needs
 * to see the key.
 *
 *   export BUYER_PRIVATE_KEY=0x...        # a wallet holding a little USDC on Base
 *   node scripts/first-payment.mjs
 *
 * Add --dry-run to fetch and print the payment terms without paying.
 */

import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const TARGET = process.env.TARGET_URL ?? "https://deadchannel.vercel.app/probe";
const NETWORK = process.env.TARGET_NETWORK ?? "eip155:8453";
const BODY = { url: process.env.PROBE_URL ?? "https://x402.org/protected" };
const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const terms = await fetch(TARGET, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(BODY),
});

if (terms.status !== 402) {
  fail(`expected 402 from ${TARGET}, got ${terms.status}. Nothing was paid.`);
}

const header = terms.headers.get("payment-required");
if (!header) fail("the 402 carried no PAYMENT-REQUIRED header. Nothing was paid.");

const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
const option = required.accepts?.find((a) => a.network === NETWORK);
if (!option) {
  fail(`no ${NETWORK} option offered. Available: ${required.accepts?.map((a) => a.network).join(", ")}`);
}

const priceUsd = Number(option.amount) / 1e6;
process.stdout.write(
  [
    `resource : ${required.resource.url}`,
    `network  : ${option.network}`,
    `price    : $${priceUsd} (${option.amount} atomic ${option.extra?.name ?? "?"})`,
    `payTo    : ${option.payTo}`,
    "",
  ].join("\n"),
);

if (dryRun) {
  process.stdout.write("dry run, nothing paid\n");
  process.exit(0);
}

const key = process.env.BUYER_PRIVATE_KEY;
if (!key) fail("set BUYER_PRIVATE_KEY to pay. It is never printed or stored.");
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("BUYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key.");

const account = privateKeyToAccount(key);
process.stdout.write(`paying from ${account.address}\n\n`);

const client = new x402Client().register(NETWORK, new ExactEvmScheme(account));
const paidFetch = wrapFetchWithPayment(fetch, client);

const res = await paidFetch(TARGET, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(BODY),
});

const receiptHeader = res.headers.get("payment-response");
const receipt = receiptHeader ? decodePaymentResponseHeader(receiptHeader) : null;

process.stdout.write(`status   : ${res.status}\n`);
if (receipt) {
  process.stdout.write(`settled  : ${receipt.success}\n`);
  if (receipt.transaction) {
    process.stdout.write(`tx       : ${receipt.transaction}\n`);
    process.stdout.write(`explorer : https://basescan.org/tx/${receipt.transaction}\n`);
  }
  if (receipt.errorReason) process.stdout.write(`error    : ${receipt.errorReason}\n`);
}
process.stdout.write(`\n${JSON.stringify(await res.json(), null, 2)}\n`);
