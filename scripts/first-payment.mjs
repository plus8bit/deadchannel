#!/usr/bin/env node
/**
 * Make the first real payment to this service, which is what puts it in the Bazaar.
 *
 * Facilitators index a resource when they observe a settled payment for it —
 * there is no registration endpoint. So the catalog listing is bootstrapped by
 * buying from yourself once, for the price of the call plus gas.
 *
 * The key is prompted for with echo off, so it never appears on the command
 * line, in shell history, or in the environment of any other process. It is
 * used once by the local signer and then discarded — what leaves this machine
 * is a signature, never the key.
 *
 *   node scripts/first-payment.mjs --dry-run   # show the terms, pay nothing
 *   node scripts/first-payment.mjs             # prompts for the key, then pays
 *
 * BUYER_PRIVATE_KEY is still honoured for unattended use, but typing it into a
 * shell puts it in history, so the prompt is the better path.
 */

import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createInterface } from "node:readline";

const TARGET = process.env.TARGET_URL ?? "https://deadchannel.vercel.app/probe";
const NETWORK = process.env.TARGET_NETWORK ?? "eip155:8453";
const BODY = { url: process.env.PROBE_URL ?? "https://x402.org/protected" };
const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * Reads a line with the terminal echo suppressed.
 *
 * readline redraws its own line when asked a question, which wipes anything
 * written to stdout beforehand — so the prompt has to be passed to `question`
 * and the echo suppressed by overriding how readline writes, not by clearing
 * the line afterwards. An invisible prompt is dangerous here: someone holding
 * a private key needs to be certain what is asking for it.
 */
function promptHidden(question) {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let asking = false;
    rl._writeToOutput = (chunk) => {
      // Show the prompt itself; swallow everything the user types.
      if (!asking || chunk.includes(question)) rl.output.write(chunk);
    };
    asking = true;
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
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

const key = process.env.BUYER_PRIVATE_KEY ?? (await promptHidden("private key of the paying wallet: "));
if (!key) fail("no key given, nothing was paid.");
if (!/^0x[0-9a-fA-F]{64}$/.test(key.trim())) {
  fail("that is not a 0x-prefixed 32-byte hex key. Nothing was paid.");
}

const account = privateKeyToAccount(key.trim());
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
