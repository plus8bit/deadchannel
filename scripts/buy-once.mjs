#!/usr/bin/env node
/**
 * Buy once from a supplier, to find out what the money actually gets.
 *
 * A resale shelf can be wired, priced and deployed while the purchase behind it
 * has never succeeded — the supplier publishes no input schema, so the request
 * shape is read off its prose and stays a guess until a real call proves it.
 * Selling that is selling a promise. This makes the call, on purpose, for the
 * price of one order.
 *
 *   node --experimental-strip-types scripts/buy-once.mjs fullenrich-people figma.com
 *
 * The operating key is prompted for with the echo off. It signs locally and is
 * never written anywhere.
 */

import { createInterface } from "node:readline";
import { SUPPLIERS } from "../src/hosaka/suppliers/types.ts";
import { buy, floatUsd } from "../src/hosaka/suppliers/buy.ts";

const id = process.argv[2];
const domain = process.argv[3];
const supplier = SUPPLIERS[id];

if (!supplier || !domain) {
  process.stderr.write(`usage: buy-once.mjs <${Object.keys(SUPPLIERS).join("|")}> <domain>\n`);
  process.exit(1);
}
if (!supplier.byDomain) {
  process.stderr.write(`${id} has no domain lookup configured\n`);
  process.exit(1);
}

const body = supplier.byDomain.build(domain);

process.stdout.write(
  [
    `supplier : ${supplier.name}`,
    `endpoint : ${supplier.method} ${supplier.url}`,
    `price    : $${supplier.listPriceUsd} (refuses above $${supplier.maxPriceUsd})`,
    `mapping  : ${JSON.stringify(body)}${supplier.byDomain.unverified ? "   <- never proven" : ""}`,
    "",
  ].join("\n"),
);

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

const key = process.env.HOSAKA_OPERATING_KEY ?? (await promptHidden("operating wallet private key (hidden): "));
if (!key) {
  process.stderr.write("no key given. Nothing was bought.\n");
  process.exit(1);
}

const { privateKeyToAccount } = await import("viem/accounts");
const account = privateKeyToAccount(key.trim().startsWith("0x") ? key.trim() : `0x${key.trim()}`);
const float = await floatUsd(account.address);
process.stdout.write(`paying from ${account.address} (holds $${float?.toFixed(4) ?? "?"})\n\n`);

let purchase;
try {
  purchase = await buy(supplier, body, { privateKey: key.trim().startsWith("0x") ? key.trim() : `0x${key.trim()}` });
} catch (err) {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

process.stdout.write(`paid     : $${purchase.paidUsd}\n`);
if (purchase.transaction) process.stdout.write(`tx       : ${purchase.transaction}\n`);
process.stdout.write(`\n${JSON.stringify(purchase.data, null, 2).slice(0, 2500)}\n`);
