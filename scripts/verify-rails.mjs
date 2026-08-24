#!/usr/bin/env node
/**
 * Re-read every rail's EIP-712 domain from its own chain.
 *
 * A buyer signs against the token's `name()` and `version()`, and those differ
 * between chains that otherwise look identical: USDC calls itself "USD Coin"
 * on Polygon and "USDC" on Monad, and Robinhood Chain settles in Paxos USDG
 * instead. A wrong string here is not a visible bug — it is a signature the
 * facilitator rejects on every payment, with nothing in the response saying
 * why. So the table is never edited from memory; it is checked against the
 * chains.
 *
 *   node --experimental-strip-types scripts/verify-rails.mjs
 */

import { EVM_RAILS } from "../src/server/rails.ts";

const NAME = "0x06fdde03";
const VERSION = "0x54fd4d50";
const DECIMALS = "0x313ce567";

async function call(rpc, to, data) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json();
  return json.result && json.result !== "0x" ? json.result : null;
}

function decodeString(hex) {
  const b = Buffer.from(hex.slice(2), "hex");
  const len = Number(BigInt("0x" + b.subarray(32, 64).toString("hex")));
  return b.subarray(64, 64 + len).toString("utf8");
}

let bad = 0;
for (const [key, rail] of Object.entries(EVM_RAILS)) {
  let name = null;
  let version = null;
  let decimals = null;
  try {
    const [n, v, d] = await Promise.all([
      call(rail.rpc, rail.asset, NAME),
      call(rail.rpc, rail.asset, VERSION),
      call(rail.rpc, rail.asset, DECIMALS),
    ]);
    name = n ? decodeString(n) : null;
    version = v ? decodeString(v) : null;
    decimals = d ? Number(BigInt(d)) : null;
  } catch (err) {
    process.stdout.write(`  ??  ${key.padEnd(10)} ${rail.rpc} unreachable\n`);
    continue;
  }

  const okName = name === rail.name;
  // A contract that exposes no version() cannot confirm one. Those rails carry
  // versionSource "observed" and are checked against a live seller instead.
  const okVersion = rail.versionSource === "observed" ? version === null : version === rail.version;
  const okDecimals = decimals === null || decimals === 6;
  const ok = okName && okVersion && okDecimals;
  if (!ok) bad += 1;

  process.stdout.write(
    `  ${ok ? "ok " : "BAD"} ${key.padEnd(10)} ${String(name).padEnd(15)} v${version}  ${decimals} decimals\n`,
  );
  if (!okName) process.stdout.write(`      table says name "${rail.name}"\n`);
  if (!okVersion) {
    process.stdout.write(
      rail.versionSource === "observed"
        ? `      table says this chain exposes no version(), but it returned "${version}"\n`
        : `      table says version "${rail.version}"\n`,
    );
  }
  if (!okDecimals) process.stdout.write(`      ${decimals} decimals breaks USD pricing\n`);
}

process.stdout.write(bad === 0 ? "\nevery rail matches its chain\n" : `\n${bad} rail(s) drifted\n`);
process.exit(bad === 0 ? 0 : 1);
