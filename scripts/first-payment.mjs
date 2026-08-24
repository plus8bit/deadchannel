#!/usr/bin/env node
/**
 * Make the first real payment to a route, which is what puts it in the Bazaar.
 *
 * Facilitators index a resource when they observe a settled payment for it —
 * there is no registration endpoint. So the catalog listing is bootstrapped by
 * buying from yourself once, for the price of the call plus gas.
 *
 * The same settled call is also what refreshes the metadata already indexed:
 * the Bazaar record's lastUpdated tracks the last payment, not the last deploy,
 * so a rewritten description reaches the catalog only when something is bought.
 * TARGET_URL therefore takes a comma-separated list, paid in order, and the run
 * stops at the first failure — the resale shelves pay their supplier before our
 * own settlement lands, so continuing past a failure spends money twice.
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

const TARGETS = (process.env.TARGET_URL ?? "https://deadchannel.vercel.app/probe")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const NETWORK = process.env.TARGET_NETWORK ?? "eip155:8453";
// Each shop takes its own field: deadchannel grades a URL, Hosaka profiles a
// domain. Chosen from the target so one script serves both.
const bodyFor = (target) =>
  process.env.REQUEST_BODY
    ? JSON.parse(process.env.REQUEST_BODY)
    : target.includes("hosaka")
      ? { domain: process.env.DOMAIN ?? "figma.com" }
      : { url: process.env.PROBE_URL ?? "https://x402.org/protected" };
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

/** Reads the 402 without paying: the price, and proof the chain is on offer. */
async function quote(target) {
  const terms = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyFor(target)),
  });
  if (terms.status !== 402) {
    fail(`expected 402 from ${target}, got ${terms.status}. Nothing was paid.`);
  }
  const header = terms.headers.get("payment-required");
  if (!header) fail(`the 402 from ${target} carried no PAYMENT-REQUIRED header. Nothing was paid.`);

  const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  const option = required.accepts?.find((a) => a.network === NETWORK);
  if (!option) {
    fail(`${target} offers no ${NETWORK}. Available: ${required.accepts?.map((a) => a.network).join(", ")}`);
  }
  return { target, priceUsd: Number(option.amount) / 1e6, payTo: option.payTo };
}

const quotes = [];
for (const target of TARGETS) quotes.push(await quote(target));

for (const q of quotes) {
  process.stdout.write(`${q.target}\n  $${q.priceUsd.toFixed(2)} on ${NETWORK} to ${q.payTo}\n`);
}
const total = quotes.reduce((sum, q) => sum + q.priceUsd, 0);
if (quotes.length > 1) process.stdout.write(`\ntotal: $${total.toFixed(2)} across ${quotes.length} calls\n`);

if (dryRun) {
  process.stdout.write("\ndry run, nothing paid\n");
  process.exit(0);
}

const key = process.env.BUYER_PRIVATE_KEY ?? (await promptHidden("\nprivate key of the paying wallet: "));
if (!key) fail("no key given, nothing was paid.");
if (!/^0x[0-9a-fA-F]{64}$/.test(key.trim())) {
  fail("that is not a 0x-prefixed 32-byte hex key. Nothing was paid.");
}

const account = privateKeyToAccount(key.trim());
process.stdout.write(`\npaying from ${account.address}\n`);

const client = new x402Client().register(NETWORK, new ExactEvmScheme(account));
const paidFetch = wrapFetchWithPayment(fetch, client);

for (const q of quotes) {
  process.stdout.write(`\n--- ${q.target}  $${q.priceUsd.toFixed(2)}\n`);
  const res = await paidFetch(q.target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyFor(q.target)),
  });

  const receiptHeader = res.headers.get("payment-response");
  const receipt = receiptHeader ? decodePaymentResponseHeader(receiptHeader) : null;

  process.stdout.write(`status   : ${res.status}\n`);
  if (receipt) {
    process.stdout.write(`settled  : ${receipt.success}\n`);
    if (receipt.transaction) {
      process.stdout.write(`tx       : https://basescan.org/tx/${receipt.transaction}\n`);
    }
    if (receipt.errorReason) process.stdout.write(`error    : ${receipt.errorReason}\n`);
  }

  const payload = await res.json();
  // Stopping here matters: the resale shelves pay their supplier before our own
  // settlement lands, so pressing on after a failure spends money for nothing.
  if (!res.ok || (receipt && receipt.success === false)) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    fail(`${q.target} did not complete. Stopping before the next call.`);
  }
  const keys = Object.keys(payload);
  process.stdout.write(`returned : ${keys.length} fields (${keys.slice(0, 6).join(", ")})\n`);
}

process.stdout.write("\ndone. The Bazaar recrawls on settlement; allow up to six hours for ranking.\n");
