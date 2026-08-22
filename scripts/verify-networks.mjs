#!/usr/bin/env node
/**
 * Check our network constants against the facilitator that actually settles.
 *
 * A genesis hash cannot be verified by looking at it. Algorand's TestNet id has
 * two spellings in circulation whose first 32 characters are identical, so one
 * reconstructed from a prefix is the right length, the right alphabet, and
 * wrong — and it fails at settlement, long after it looked correct.
 *
 * This is a script rather than a test because it needs the network, and a test
 * suite that fails when the wifi drops teaches people to ignore it.
 *
 *   node --experimental-strip-types scripts/verify-networks.mjs
 */

import {
  ALGORAND_MAINNET,
  ALGORAND_TESTNET,
  GOPLAUSIBLE_FEE_PAYER,
} from "../src/server/algorand.ts";

const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://facilitator.goplausible.xyz";

const res = await fetch(`${FACILITATOR}/supported`, { headers: { accept: "application/json" } });
if (!res.ok) {
  process.stderr.write(`${FACILITATOR}/supported returned ${res.status}\n`);
  process.exit(1);
}

const kinds = (await res.json()).kinds ?? [];
const algorand = kinds.filter((k) => String(k.network ?? "").startsWith("algorand:"));

let bad = 0;
function check(label, ours, found) {
  const ok = found !== undefined;
  process.stdout.write(`${ok ? "  ok  " : "  BAD "}${label.padEnd(9)} ${ours}\n`);
  if (!ok) {
    bad += 1;
    process.stdout.write(`       facilitator serves: ${algorand.map((k) => k.network).join(", ")}\n`);
  }
}

process.stdout.write(`${FACILITATOR} publishes ${algorand.length} Algorand kinds\n\n`);
check("mainnet", ALGORAND_MAINNET, algorand.find((k) => k.network === ALGORAND_MAINNET));
check("testnet", ALGORAND_TESTNET, algorand.find((k) => k.network === ALGORAND_TESTNET));

const payers = new Set(algorand.map((k) => k.extra?.feePayer).filter(Boolean));
const payerOk = payers.has(GOPLAUSIBLE_FEE_PAYER);
process.stdout.write(`${payerOk ? "  ok  " : "  BAD "}feePayer  ${GOPLAUSIBLE_FEE_PAYER}\n`);
if (!payerOk) {
  bad += 1;
  process.stdout.write(`       facilitator serves: ${[...payers].join(", ")}\n`);
}

process.stdout.write(bad === 0 ? "\nall constants match the facilitator\n" : `\n${bad} mismatch(es)\n`);
process.exit(bad === 0 ? 0 : 1);
