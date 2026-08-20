#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { auditEntry, buildReport } from "./catalog/audit.ts";
import type { AuditedEntry } from "./catalog/audit.ts";
import { fetchCatalog } from "./catalog/discovery.ts";
import { probe } from "./probe/probe.ts";
import type { ProbeResult } from "./probe/types.ts";

const HELP = `
deadchannel scan — audit the whole public x402 catalog

  Pulls every resource the public Bazaar facilitators publish, audits what each
  one advertises about itself, and optionally live-probes a sample.

usage
  node src/scan.ts [options]

options
  --limit <n>     stop after n catalog entries (default: all)
  --live <n>      additionally live-probe n entries (default 0)
  --out <file>    write full JSON results
  -h, --help
`;

async function main(argv: string[]): Promise<number> {
  let limit = Infinity;
  let live = 0;
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      return 0;
    }
    if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg === "--live") live = Number(argv[++i]);
    else if (arg === "--out") out = argv[++i] ?? null;
    else {
      process.stderr.write(`unknown option: ${arg}\n`);
      return 2;
    }
  }

  process.stderr.write("pulling catalog…\n");
  const catalog = await fetchCatalog(limit);
  process.stderr.write(`  ${catalog.length} resources\n\n`);

  const now = Date.now();
  const audited = catalog.map((e) => auditEntry(e, now));
  const report = buildReport(audited);

  printReport(audited, report);

  let probes: ProbeResult[] = [];
  if (live > 0) {
    process.stderr.write(`\nlive-probing ${live} entries…\n`);
    probes = await probeSample(audited, live);
    printProbes(probes);
  }

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ report, audited, probes }, null, 2));
    process.stderr.write(`\nwrote ${out}\n`);
  }
  return 0;
}

/** Probe the busiest entries first — those are the ones agents actually hit. */
async function probeSample(audited: AuditedEntry[], n: number): Promise<ProbeResult[]> {
  const targets = [...audited]
    .sort((a, b) => (b.callsL30d ?? 0) - (a.callsL30d ?? 0))
    .filter((e) => e.url.startsWith("http") && !/\/:[a-zA-Z]/.test(e.url))
    .slice(0, n);

  const results: ProbeResult[] = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((t) =>
        probe(t.url, {
          samples: 1,
          timeoutMs: 8000,
          spacingMs: 0,
          // Honoring the catalog's verb avoids the false "dead" verdict a GET
          // against a POST-only route produces.
          ...(t.method ? { method: t.method } : {}),
        }),
      ),
    );
    for (const s of settled) if (s.status === "fulfilled") results.push(s.value);
    process.stderr.write(`  ${results.length}/${targets.length}\r`);
  }
  process.stderr.write("\n");
  return results;
}

function printReport(audited: AuditedEntry[], r: ReturnType<typeof buildReport>): void {
  const pct = (n: number) => `${((n / r.total) * 100).toFixed(1)}%`;
  const line = (label: string, n: number) =>
    `  ${label.padEnd(26)} ${String(n).padStart(6)}  ${pct(n).padStart(6)}\n`;

  let s = `x402 CATALOG AUDIT — ${r.total} resources\n${"─".repeat(46)}\n\n`;

  s += `DEMAND\n`;
  s += line("paid at least once /30d", r.withDemand);
  s += line("never paid /30d", r.total - r.withDemand);
  s += `  ${"total calls /30d".padEnd(26)} ${String(r.callsL30d).padStart(6)}\n\n`;

  s += `PROBLEMS\n`;
  const labels: Record<string, string> = {
    "no-demand": "no demand",
    stale: "stale (>30d idle)",
    "no-schema": "no input/output schema",
    "no-tags": "no discovery tags",
    "price-trap": "price above $5",
    "dust-price": "price below $0.0001",
    unpriceable: "price undeterminable",
    "testnet-only": "testnet only",
    "bad-payto": "missing/invalid payTo",
  };
  for (const [flag, count] of Object.entries(r.flagCounts).sort((a, b) => b[1] - a[1])) {
    s += line(labels[flag] ?? flag, count);
  }

  s += `\nPRICE DISTRIBUTION\n`;
  for (const [bucket, count] of Object.entries(r.priceBuckets)) {
    if (count > 0) s += line(bucket, count);
  }

  s += `\nNETWORKS\n`;
  for (const [net, count] of Object.entries(r.networks).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    s += line(net, count);
  }

  s += `\nCATALOG CONCENTRATION (top payout addresses)\n`;
  for (const op of r.operators.slice(0, 5)) {
    s += `  ${op.payTo.slice(0, 10)}…${op.payTo.slice(-6)}  ${String(op.resources).padStart(5)} resources  ${pct(op.resources).padStart(6)}  ${op.callsL30d} calls\n`;
  }

  const clean = audited.filter((e) => e.flags.length === 0).length;
  s += `\nCLEAN (no flags at all): ${clean} of ${r.total} — ${pct(clean)}\n`;

  process.stdout.write(s);
}

function printProbes(probes: ProbeResult[]): void {
  const counts: Record<string, number> = {};
  for (const p of probes) counts[p.verdict] = (counts[p.verdict] ?? 0) + 1;
  let s = `\nLIVE PROBE — ${probes.length} busiest endpoints\n${"─".repeat(46)}\n`;
  for (const [verdict, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    s += `  ${verdict.padEnd(26)} ${String(n).padStart(6)}  ${((n / probes.length) * 100).toFixed(1)}%\n`;
  }
  process.stdout.write(s);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
