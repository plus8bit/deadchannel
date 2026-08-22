#!/usr/bin/env node
/**
 * Pay an x402 resource on Algorand.
 *
 * Algorand's exact scheme is not a signed authorization like the EVM one. It is
 * an atomic group of two transactions: the facilitator's fee payer sends itself
 * zero ALGO and carries double the fee, and the buyer's asset transfer carries
 * none. Grouping them means neither executes unless both do, which is what lets
 * a buyer pay in USDC while holding no ALGO for fees.
 *
 * Only the buyer's transaction is signed here. The fee payer's half travels
 * unsigned and is signed by the facilitator, which is the whole point: we are
 * not able to spend from an account we do not hold.
 *
 * The shape was read off GoPlausible's own client rather than guessed — see
 * paymentGroup/paymentIndex below.
 *
 *   node scripts/pay-algorand.mjs https://hosaka-agents.vercel.app/lookup '{"domain":"stripe.com"}'
 *
 * The 25-word mnemonic is prompted for with the echo off. It is used once by
 * the local signer and never written anywhere.
 */

import algosdk from "algosdk";
import { createInterface } from "node:readline";

const TARGET = process.argv[2];
const BODY = process.argv[3] ?? "{}";
const ALGOD = process.env.ALGOD_URL ?? "https://mainnet-api.algonode.cloud";

if (!TARGET) {
  process.stderr.write("usage: node scripts/pay-algorand.mjs <url> [json-body]\n");
  process.exit(1);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

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

// ---- 1. Ask for the terms, paying nothing. ----------------------------------

const terms = await fetch(TARGET, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: BODY,
});
if (terms.status !== 402) fail(`expected 402 from ${TARGET}, got ${terms.status}. Nothing was paid.`);

const header = terms.headers.get("payment-required");
if (!header) fail("the 402 carried no PAYMENT-REQUIRED header. Nothing was paid.");
const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));

const accepted = (required.accepts ?? []).find((a) => String(a.network ?? "").startsWith("algorand:"));
if (!accepted) {
  fail(`no Algorand option offered. Available: ${(required.accepts ?? []).map((a) => a.network).join(", ")}`);
}

const priceUsd = Number(accepted.amount) / 1e6;
const feePayer = accepted.extra?.feePayer ?? null;

process.stdout.write(
  [
    `resource : ${required.resource?.url ?? TARGET}`,
    `network  : ${accepted.network}`,
    `asset    : ${accepted.asset} (USDC)`,
    `price    : $${priceUsd}`,
    `payTo    : ${accepted.payTo}`,
    `feePayer : ${feePayer ?? "(none — you pay the fee yourself)"}`,
    "",
  ].join("\n"),
);

// ---- 2. The buyer's key, used locally and discarded. ------------------------

const phrase = process.env.ALGORAND_MNEMONIC ?? (await promptHidden("buyer 25-word mnemonic (hidden): "));
if (!phrase) fail("no mnemonic given. Nothing was paid.");

let account;
try {
  account = algosdk.mnemonicToSecretKey(phrase.trim().replace(/\s+/g, " "));
} catch (err) {
  fail(`that is not a valid 25-word Algorand mnemonic: ${err instanceof Error ? err.message : String(err)}`);
}
process.stdout.write(`paying from ${account.addr}\n\n`);

// ---- 3. Build the group exactly as the scheme requires. ---------------------

const algod = new algosdk.Algodv2("", ALGOD, "");
const params = await algod.getTransactionParams().do();
const minFee = params.minFee ?? 1000n;

const group = [];
let paymentIndex = 0;

if (feePayer) {
  // Zero-amount self-payment carrying twice the fee: it pays for both halves.
  group.push(
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: feePayer,
      receiver: feePayer,
      amount: 0,
      note: new TextEncoder().encode(`x402-fee-payer-${Date.now()}`),
      suggestedParams: { ...params, flatFee: true, fee: BigInt(minFee) * 2n },
    }),
  );
  paymentIndex = 1;
}

group.push(
  algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: accepted.payTo,
    amount: BigInt(accepted.amount),
    assetIndex: BigInt(accepted.asset),
    note: new TextEncoder().encode(TARGET),
    suggestedParams: { ...params, flatFee: true, fee: feePayer ? 0n : BigInt(minFee) },
  }),
);

if (group.length > 1) algosdk.assignGroupID(group);

const encoded = group.map((t) => algosdk.encodeUnsignedTransaction(t));
const signed = group[paymentIndex].signTxn(account.sk);

const payload = {
  x402Version: 2,
  payload: {
    // Our half signed, the fee payer's half left for the facilitator to sign.
    paymentGroup: encoded.map((bytes, i) =>
      Buffer.from(i === paymentIndex ? signed : bytes).toString("base64"),
    ),
    paymentIndex,
  },
  resource: required.resource ?? { url: TARGET },
  accepted,
  ...(required.extensions ? { extensions: required.extensions } : {}),
};

// ---- 4. Pay. ----------------------------------------------------------------

const paid = await fetch(TARGET, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  },
  body: BODY,
});

const receipt = paid.headers.get("payment-response");
const settle = receipt ? JSON.parse(Buffer.from(receipt, "base64").toString("utf8")) : null;

process.stdout.write(`status   : ${paid.status}\n`);
if (settle) {
  process.stdout.write(`settled  : ${settle.success ?? settle.settled ?? "?"}\n`);
  const tx = settle.transaction ?? settle.txId ?? null;
  if (tx) {
    process.stdout.write(`tx       : ${tx}\n`);
    process.stdout.write(`explorer : https://allo.info/tx/${tx}\n`);
  }
  if (settle.errorReason) process.stdout.write(`reason   : ${settle.errorReason}\n`);
}
process.stdout.write(`\n${(await paid.text()).slice(0, 900)}\n`);
process.exit(paid.ok ? 0 : 1);
