#!/usr/bin/env node
/**
 * Ask Coinbase to re-check the listing.
 *
 * Runs the same 25 preflight checks the Bazaar applies before indexing, and
 * reports whether the resource is currently active in the index. Needs no key
 * and moves no money, so it is safe to run whenever.
 *
 *   node scripts/validate-listing.mjs
 */

const RESOURCE = process.env.RESOURCE_URL ?? "https://deadchannel.vercel.app/probe";
const METHOD = process.env.RESOURCE_METHOD ?? "POST";
const VALIDATOR = "https://api.cdp.coinbase.com/platform/v2/x402/validate";

const res = await fetch(VALIDATOR, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ resource: RESOURCE, method: METHOD }),
});

if (!res.ok) {
  process.stderr.write(`validator returned ${res.status}\n${await res.text()}\n`);
  process.exit(1);
}

const report = await res.json();
const checks = Array.isArray(report.preflight) ? report.preflight : [];
const failed = checks.filter((c) => c && c.ok === false);

process.stdout.write(`resource : ${RESOURCE}\n`);
process.stdout.write(`valid    : ${report.valid}\n`);
process.stdout.write(`accepted : ${report.simulation?.outcome ?? "unknown"}\n`);
process.stdout.write(`checks   : ${checks.length - failed.length}/${checks.length} passed\n`);

if (report.index) {
  process.stdout.write(`indexed  : active=${report.index.active} lastCrawled=${report.index.lastCrawledAt}\n`);
} else {
  process.stdout.write("indexed  : not yet — the Bazaar indexes after a settled payment\n");
}

for (const c of failed) {
  process.stdout.write(`  FAIL ${c.name}: ${c.detail ?? ""}\n`);
}

// Non-zero when the listing would be rejected, so this works as a monitor.
process.exit(report.valid === true && failed.length === 0 ? 0 : 1);
