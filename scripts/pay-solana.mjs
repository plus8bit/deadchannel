#!/usr/bin/env node
/**
 * Pays one of our endpoints on Solana, to prove that rail carries real money.
 *
 * We advertise seven chains and have only ever settled on two. A rail nobody
 * has tested is a promise the first buyer gets to discover, and Solana is the
 * one where that matters most: it carries more x402 transactions than any other
 * chain while being served by a fraction of the sellers.
 *
 * The fee payer is the facilitator's, not ours, so the paying wallet needs USDC
 * and no SOL. It does need a USDC token account, which only exists once someone
 * has sent it USDC — a wallet that has never held any cannot receive a refund
 * either, so send it a little before running this.
 *
 *   node scripts/pay-solana.mjs --dry-run     # read the offer, pay nothing
 *   node scripts/pay-solana.mjs               # prompts for the key, then pays
 *
 * The key is a base58 secret key as exported by Phantom or Solflare. It is
 * prompted for with the echo off and used once by the local signer.
 */

import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { createInterface } from "node:readline";

const TARGET = process.env.TARGET_URL ?? "https://hosaka-agents.vercel.app/lookup";
const NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BODY = process.env.REQUEST_BODY
  ? JSON.parse(process.env.REQUEST_BODY)
  : TARGET.includes("hosaka")
    ? { domain: process.env.DOMAIN ?? "figma.com" }
    : { url: process.env.PROBE_URL ?? "https://x402.org/protected" };
const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const usd = (n) => `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;

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
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

const terms = await fetch(TARGET, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(BODY),
});
if (terms.status !== 402) fail(`expected 402 from ${TARGET}, got ${terms.status}. Nothing was paid.`);

const header = terms.headers.get("payment-required");
if (!header) fail("the 402 carried no PAYMENT-REQUIRED header. Nothing was paid.");
const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
const offer = required.accepts?.find((a) => a.network === NETWORK);
if (!offer) {
  fail(`${TARGET} offers no Solana rail. Available: ${required.accepts?.map((a) => a.network).join(", ")}`);
}

const priceUsd = Number(offer.amount) / 1e6;
process.stdout.write(
  `${TARGET}\n  ${usd(priceUsd)} on Solana to ${offer.payTo}\n` +
    `  fee payer: ${offer.extra?.feePayer ?? "the facilitator"}\n`,
);

if (dryRun) {
  process.stdout.write("\ndry run, nothing paid\n");
  process.exit(0);
}

const key = process.env.SOLANA_PRIVATE_KEY ?? (await promptHidden("\nbase58 secret key of the paying wallet: "));
if (!key) fail("no key given, nothing was paid.");

let signer;
try {
  const bytes = new Uint8Array(getBase58Encoder().encode(key.trim()));
  // Phantom exports 64 bytes (secret plus public); the 32-byte form is the
  // seed alone. Telling them apart here beats a decoding error deep in a
  // library, which reads like our bug rather than a pasted-wrong key.
  if (bytes.length !== 64) fail(`expected a 64-byte base58 secret key, got ${bytes.length} bytes. Nothing was paid.`);
  signer = await createKeyPairSignerFromBytes(bytes);
} catch (err) {
  fail(`that key could not be read: ${err.message}. Nothing was paid.`);
}

process.stdout.write(`\npaying from ${signer.address}\n`);
if (signer.address === offer.payTo) {
  fail("the paying wallet is the receiving wallet. A payment to yourself proves nothing and will be refused.");
}

// The signer is the first positional argument, not a field on a config object.
// Passing { signer } silently hands the library an object where it expects a
// key and fails deep inside, which reads like the endpoint is broken.
const client = new x402Client().register(
  NETWORK,
  new ExactSvmScheme(signer, { rpcUrl: process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com" }),
);
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
    process.stdout.write(`tx       : https://solscan.io/tx/${receipt.transaction}\n`);
  }
  if (receipt.errorReason) process.stdout.write(`error    : ${receipt.errorReason}\n`);
}

const payload = await res.json().catch(() => null);
if (!res.ok || (receipt && receipt.success === false)) {
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  fail("the Solana rail did not carry the payment.");
}
process.stdout.write(`returned : ${Object.keys(payload ?? {}).length} fields\n\nSolana works.\n`);
