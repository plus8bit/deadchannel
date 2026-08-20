#!/usr/bin/env node
import { probe } from "./probe/probe.ts";
import type { ProbeResult, SignalStatus } from "./probe/types.ts";

const HELP = `
deadchannel — risk oracle for x402 endpoints

  probe one or more x402 resource URLs and report whether they are alive,
  honestly priced, and safe for an agent to call. Never spends money.

usage
  node src/cli.ts <url> [url...] [options]

options
  --samples <n>    HTTP probes per target (default 3)
  --timeout <ms>   per-request timeout (default 10000)
  --json           machine-readable output
  --quiet          one line per target
  -h, --help       this text
`;

const MARK: Record<SignalStatus, string> = { pass: "+", warn: "!", fail: "x", skip: "-" };
const VERDICT_LABEL: Record<string, string> = {
  live: "LIVE",
  degraded: "DEGRADED",
  trap: "TRAP",
  testnet: "TESTNET",
  dead: "DEAD",
  unknown: "NOT x402",
};

async function main(argv: string[]): Promise<number> {
  const urls: string[] = [];
  let samples = 3;
  let timeoutMs = 10_000;
  let json = false;
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "-h":
      case "--help":
        process.stdout.write(HELP);
        return 0;
      case "--json":
        json = true;
        break;
      case "--quiet":
        quiet = true;
        break;
      case "--samples":
        samples = Number(argv[++i]);
        break;
      case "--timeout":
        timeoutMs = Number(argv[++i]);
        break;
      default:
        if (arg.startsWith("-")) {
          process.stderr.write(`unknown option: ${arg}\n`);
          return 2;
        }
        urls.push(arg);
    }
  }

  if (urls.length === 0) {
    process.stdout.write(HELP);
    return 2;
  }
  if (!Number.isFinite(samples) || samples < 1) {
    process.stderr.write("--samples must be a positive integer\n");
    return 2;
  }

  const results: ProbeResult[] = [];
  for (const url of urls) {
    try {
      results.push(await probe(url, { samples, timeoutMs }));
    } catch (err) {
      process.stderr.write(`${url}: could not probe — ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    for (const r of results) process.stdout.write(render(r, quiet));
  }

  // Non-zero when any target is unsafe to call, so this works in CI.
  return results.some((r) => r.verdict === "trap" || r.verdict === "dead") ? 1 : 0;
}

function render(r: ProbeResult, quiet: boolean): string {
  const price = r.priceUsd === null ? "price unknown" : `$${trim(r.priceUsd)}`;
  const p99 = r.latency ? `${r.latency.p99}ms p99` : "no timing";
  const head = `${pad(VERDICT_LABEL[r.verdict] ?? r.verdict, 9)} risk ${pad(String(r.risk), 3)}  ${price}  ${p99}  ${r.url}\n`;
  if (quiet) return head;

  const lines = [head];
  for (const s of r.signals) {
    if (s.status === "pass" && r.verdict === "live") continue; // keep clean results short
    lines.push(`  ${MARK[s.status]} ${pad(s.id, 18)} ${s.detail}\n`);
  }
  lines.push("\n");
  return lines.join("");
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function trim(n: number): string {
  return n < 0.01 ? n.toFixed(6).replace(/0+$/, "") : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
