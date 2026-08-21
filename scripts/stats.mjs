#!/usr/bin/env node
/**
 * What the endpoint earned and whether anyone found it.
 *
 * Revenue comes from the chain rather than our own logs: USDC Transfer events
 * to the payout address are the one number nobody can inflate, including us.
 * Catalog demand comes from the facilitator, which counts settled calls.
 *
 * Caveat worth keeping in mind: this counts every USDC transfer to the payout
 * address, not only payments for this endpoint. Anything else sent there shows
 * up as revenue. The per-payment list below is there so the difference is
 * visible rather than assumed.
 *
 *   npm run stats            # today
 *   npm run stats -- 7       # last 7 days
 */

import defaults from "../deadchannel.config.json" with { type: "json" };
import { fetchCatalog } from "../src/catalog/discovery.ts";
import { probe } from "../src/probe/probe.ts";

const PAY_TO = (process.env.X402_PAY_TO ?? defaults.payTo).toLowerCase();
const RESOURCE = process.env.RESOURCE_URL ?? `${defaults.publicUrl}/probe`;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.llamarpc.com"];
const BLOCK_SECONDS = 2;
/** Public RPCs reject wide getLogs ranges, so walk the window in chunks. */
const CHUNK = 9_000;

const days = Number(process.argv[2] ?? 1);
const since = Date.now() - days * 86_400_000;

async function rpc(method, params) {
  let lastError;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "deadchannel-stats" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.message);
      return body.result;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`all RPCs failed: ${lastError instanceof Error ? lastError.message : lastError}`);
}

function pad32(address) {
  return `0x${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}

const head = Number(await rpc("eth_blockNumber", []));
const span = Math.ceil((days * 86_400) / BLOCK_SECONDS);
const from = Math.max(0, head - span);

const payments = [];
for (let start = from; start <= head; start += CHUNK) {
  const end = Math.min(start + CHUNK - 1, head);
  const logs = await rpc("eth_getLogs", [
    {
      address: USDC,
      topics: [TRANSFER, null, pad32(PAY_TO)],
      fromBlock: `0x${start.toString(16)}`,
      toBlock: `0x${end.toString(16)}`,
    },
  ]);
  for (const log of logs) {
    payments.push({
      usd: Number(BigInt(log.data)) / 1e6,
      from: `0x${log.topics[1].slice(-40)}`,
      tx: log.transactionHash,
      block: Number(log.blockNumber),
    });
  }
  process.stderr.write(`\r  scanning blocks ${end - from}/${head - from}`);
}
process.stderr.write("\r\x1b[2K");

const total = payments.reduce((a, p) => a + p.usd, 0);
const buyers = new Set(payments.map((p) => p.from.toLowerCase()));
const external = payments.filter((p) => !p.from.toLowerCase().startsWith("0x366525bd"));

const label = days === 1 ? "last 24 hours" : `last ${days} days`;
const out = [
  ``,
  `  REVENUE  ${label}`,
  `  ${"─".repeat(52)}`,
  `  USDC received      $${total.toFixed(4)}`,
  `  payments           ${payments.length}`,
  `  distinct buyers    ${buyers.size}`,
  `  not our own wallet ${external.length}`,
  ``,
];

for (const p of payments.slice(-6)) {
  out.push(`    $${p.usd.toFixed(4).padStart(8)}  from ${p.from.slice(0, 10)}…  block ${p.block}`);
}
if (payments.length > 6) out.push(`    …and ${payments.length - 6} earlier`);

process.stdout.write(`${out.join("\n")}\n\n`);

// ── catalog + liveness ──────────────────────────────────────────────────────
const [catalog, health] = await Promise.all([
  fetchCatalog().catch(() => []),
  probe(RESOURCE, { samples: 1, method: "POST" }).catch(() => null),
]);

const mine = catalog.filter((e) => e.url === RESOURCE);
process.stdout.write(`  LISTING\n  ${"─".repeat(52)}\n`);
if (mine.length === 0) {
  process.stdout.write(`  not in the catalog (${catalog.length} resources scanned)\n`);
} else {
  for (const m of mine) {
    process.stdout.write(`  in catalog         yes, of ${catalog.length} resources\n`);
    process.stdout.write(`  settled calls /30d ${m.callsL30d ?? 0}\n`);
    process.stdout.write(`  unique payers /30d ${m.uniquePayersL30d ?? 0}\n`);
    process.stdout.write(`  last called        ${m.lastCalledAt ?? "never"}\n`);
  }
}
if (health) {
  process.stdout.write(`  endpoint           ${health.verdict.toUpperCase()}, risk ${health.risk}, ${health.latency?.p99 ?? "?"}ms p99\n`);
}
process.stdout.write("\n");
void since;
