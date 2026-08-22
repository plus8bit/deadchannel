#!/usr/bin/env node
/**
 * Work out which query parameter an undocumented supplier actually reads.
 *
 * Most x402 sellers publish no input schema — not a description, not a tag, in
 * several cases not even a name. Buying from them means guessing the one field
 * they want, and a wrong guess is indistinguishable from an empty result: the
 * payment settles, a 200 comes back, and the answer is to a question nobody
 * asked.
 *
 * Sending every plausible spelling at once fixes the guessing but not the
 * knowing, because they all carry the same value. So this sends each candidate
 * a DIFFERENT value and reads which one comes back. One purchase, and the
 * ambiguity is gone for good.
 *
 *   node scripts/learn-parameter.mjs <supplier-id>
 *
 * The key is prompted for with the echo off: it is used once by the local
 * signer and never written anywhere.
 */

import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createInterface } from "node:readline";
import { SUPPLIERS } from "../src/hosaka/suppliers/types.ts";

const id = process.argv[2];
const supplier = SUPPLIERS[id];
if (!supplier) {
  process.stderr.write(`usage: node scripts/learn-parameter.mjs <${Object.keys(SUPPLIERS).join("|")}>\n`);
  process.exit(1);
}
if (supplier.method !== "GET") {
  process.stderr.write(`${id} is a POST endpoint; this script discriminates query parameters.\n`);
  process.exit(1);
}

// A distinct, unmistakable value per candidate. Whichever one the endpoint
// echoes, or answers about, is the field it reads.
const PROBES = {
  query: "stripe.com",
  website_url: "https://figma.com",
  domain: "notion.so",
  url: "https://linear.app",
  website: "vercel.com",
};

function promptHidden(question) {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let asking = false;
    rl._writeToOutput = (chunk) => {
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

const url = new URL(supplier.url);
for (const [k, v] of Object.entries(PROBES)) url.searchParams.set(k, v);

process.stdout.write(
  [
    `supplier : ${supplier.name}`,
    `endpoint : ${supplier.url}`,
    `price    : $${supplier.listPriceUsd} (ceiling $${supplier.maxPriceUsd})`,
    "",
    "sending one distinct value per candidate field:",
    ...Object.entries(PROBES).map(([k, v]) => `  ${k.padEnd(12)} = ${v}`),
    "",
  ].join("\n"),
);

const key = process.env.HOSAKA_OPERATING_KEY ?? (await promptHidden("operating wallet private key (hidden): "));
if (!key) {
  process.stderr.write("no key given. Nothing was paid.\n");
  process.exit(1);
}

const account = privateKeyToAccount(key.trim().startsWith("0x") ? key.trim() : `0x${key.trim()}`);
process.stdout.write(`paying from ${account.address}\n\n`);

const client = new x402Client().register("eip155:8453", new ExactEvmScheme(account));
const res = await wrapFetchWithPayment(fetch, client)(url.toString(), {
  method: "GET",
  headers: { accept: "application/json" },
});

const body = await res.text();
const receipt = res.headers.get("payment-response");
const settled = receipt ? decodePaymentResponseHeader(receipt) : null;

process.stdout.write(`status   : ${res.status}\n`);
if (settled?.transaction) {
  process.stdout.write(`tx       : ${settled.transaction}\n`);
}

// Which probe value survived into the answer.
const hits = Object.entries(PROBES).filter(([, v]) => body.includes(v.replace(/^https?:\/\//, "")));
process.stdout.write("\n");
if (hits.length === 1) {
  process.stdout.write(`the field is: ${hits[0][0]}\n`);
} else if (hits.length === 0) {
  process.stdout.write("no probe value came back. The endpoint reads none of these names.\n");
} else {
  process.stdout.write(`ambiguous — ${hits.map(([k]) => k).join(", ")} all appear in the response.\n`);
}
process.stdout.write(`\n${body.slice(0, 900)}\n`);
