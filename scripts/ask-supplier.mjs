#!/usr/bin/env node
/**
 * Ask a supplier what it wants, without buying anything.
 *
 * These endpoints validate before they settle: a request they refuse costs
 * nothing, and the refusal usually names the fields they accept. That makes a
 * deliberately incomplete request the cheapest schema available for an API
 * that publishes none — and far cheaper than learning the same thing from a
 * purchase.
 *
 *   node --experimental-strip-types scripts/ask-supplier.mjs fullenrich-people '{}'
 *   node --experimental-strip-types scripts/ask-supplier.mjs fullenrich-people '{"current_company_domains":["stripe.com"],"limit":25}'
 *
 * A request the supplier ACCEPTS will be paid for. Send an empty or obviously
 * incomplete body to stay free.
 */

import { createInterface } from "node:readline";
import { SUPPLIERS } from "../src/hosaka/suppliers/types.ts";
import { buy } from "../src/hosaka/suppliers/buy.ts";

const id = process.argv[2];
const bodyText = process.argv[3] ?? "{}";
const supplier = SUPPLIERS[id];

if (!supplier) {
  process.stderr.write(`usage: ask-supplier.mjs <${Object.keys(SUPPLIERS).join("|")}> '<json>'\n`);
  process.exit(1);
}

let body;
try {
  body = JSON.parse(bodyText);
} catch {
  process.stderr.write(`that is not JSON: ${bodyText}\n`);
  process.exit(1);
}

process.stdout.write(
  [
    `supplier : ${supplier.name}`,
    `endpoint : ${supplier.method} ${supplier.url}`,
    `sending  : ${JSON.stringify(body)}`,
    "",
    Object.keys(body).length === 0
      ? "empty body — expect a refusal naming what it wants, and no charge."
      : `WARNING: a body it accepts costs $${supplier.listPriceUsd}.`,
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
  process.stderr.write("no key given.\n");
  process.exit(1);
}
const privateKey = key.trim().startsWith("0x") ? key.trim() : `0x${key.trim()}`;

try {
  const purchase = await buy(supplier, body, { privateKey, probe: true });
  process.stdout.write(`\nACCEPTED and paid $${purchase.paidUsd}\n`);
  process.stdout.write(`${JSON.stringify(purchase.data, null, 2).slice(0, 4000)}\n`);
} catch (err) {
  // The interesting case: what it says it wanted.
  process.stdout.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
}
