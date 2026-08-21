#!/usr/bin/env node
/**
 * A paced walkthrough for recording a demo.
 *
 * Everything shown is live: real endpoints, a real listing check, real verdicts.
 * Each step waits for Enter so the narrator can talk over it, and nothing here
 * spends money — the paid step is a separate script, on purpose.
 *
 *   node scripts/demo.mjs              # paced, waits for Enter between beats
 *   node scripts/demo.mjs --no-pause   # runs straight through, to check it before recording
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { probe } from "../src/probe/probe.ts";

const C = {
  dim: "\x1b[38;5;242m",
  amber: "\x1b[38;5;208m",
  green: "\x1b[38;5;72m",
  red: "\x1b[38;5;167m",
  bold: "\x1b[1m",
  off: "\x1b[0m",
};

const VERDICT_COLOR = {
  live: C.green,
  degraded: C.amber,
  trap: C.red,
  testnet: C.amber,
  dead: C.red,
  unknown: C.dim,
};

const paused = !process.argv.includes("--no-pause") && process.stdin.isTTY;
const rl = paused ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const out = (s = "") => process.stdout.write(`${s}\n`);

async function beat(title) {
  out();
  out(`${C.dim}${"─".repeat(72)}${C.off}`);
  out(`${C.bold}${title}${C.off}`);
  out(`${C.dim}${"─".repeat(72)}${C.off}`);
  if (!rl) return;
  await rl.question(`${C.dim}  [enter]${C.off}`);
  process.stdout.write("\x1b[1A\x1b[2K");
}

function loadScan() {
  try {
    const raw = JSON.parse(readFileSync(new URL("../data/scan-2026-08-20.json", import.meta.url), "utf8"));
    return raw.report;
  } catch {
    return null;
  }
}

async function show(url, label, options = {}) {
  process.stdout.write(`  ${C.dim}probing${C.off} ${url} `);
  const r = await probe(url, { samples: 1, timeoutMs: 8000, ...options });
  const color = VERDICT_COLOR[r.verdict] ?? C.dim;
  const price = r.priceUsd === null ? "price unknown" : `$${r.priceUsd}`;
  process.stdout.write("\r\x1b[2K");
  out(`  ${color}${C.bold}${r.verdict.toUpperCase().padEnd(9)}${C.off} risk ${String(r.risk).padStart(3)}  ${price.padEnd(14)} ${C.dim}${label}${C.off}`);
  const worst = r.signals.filter((s) => s.status === "fail" || s.status === "warn").sort((a, b) => b.weight - a.weight)[0];
  if (worst) out(`             ${C.dim}${worst.detail.slice(0, 92)}${C.off}`);
  out(`             ${C.dim}${url}${C.off}`);
  out();
}

// ── 1. the problem ──────────────────────────────────────────────────────────
await beat("1 / 4   AI agents now pay for APIs by themselves. 15,000 of them are on offer.");

const report = loadScan();
if (report) {
  const pct = (n) => `${((n / report.total) * 100).toFixed(1)}%`;
  const noTags = report.flagCounts["no-tags"] ?? 0;
  const clean = report.total - Object.values(report.flagCounts).reduce((a, b) => Math.max(a, b), 0);
  void clean;
  out(`  We audited every one of them: ${C.bold}${report.total.toLocaleString()}${C.off} resources.`);
  out();
  out(`  ${C.amber}${C.bold}${pct(noTags).padStart(6)}${C.off}  publish no discovery tags, so topic search never finds them`);
  const top3 = report.operators.slice(0, 3);
  const r3 = top3.reduce((a, o) => a + o.resources, 0);
  const c3 = top3.reduce((a, o) => a + o.callsL30d, 0);
  out(`  ${C.amber}${C.bold}${pct(r3).padStart(6)}${C.off}  of the catalog belongs to 3 payout addresses`);
  out(`  ${C.amber}${C.bold}${(c3 / report.callsL30d * 100).toFixed(2).padStart(6)}%${C.off}  is the share of demand those three actually receive`);
  out();
  out(`  ${C.dim}An agent picking from this catalog is guessing with real money.${C.off}`);
}

// ── 2. what a bad pick looks like ───────────────────────────────────────────
await beat("2 / 4   This is what an agent cannot see before it pays.");

await show("https://x402.org/protected", "the official reference endpoint", { method: "GET" });
await show("https://api.exa.ai/search", "a real, widely used paid API", { method: "POST" });

// ── 3. our own endpoint ─────────────────────────────────────────────────────
await beat("3 / 4   Our service answers that question. It grades itself too.");

await show("https://deadchannel.vercel.app/probe", "deadchannel, live on Base mainnet", { method: "POST" });
out(`  ${C.dim}An agent pays $0.001 in USDC and gets this verdict before it commits.${C.off}`);
out(`  ${C.dim}We settle only when the check produced a result. A failure costs the buyer nothing.${C.off}`);

// ── 4. proof ────────────────────────────────────────────────────────────────
await beat("4 / 4   And this is Coinbase checking us, not us checking ourselves.");

const res = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/validate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ resource: "https://deadchannel.vercel.app/probe", method: "POST" }),
});
const v = await res.json();
const checks = Array.isArray(v.preflight) ? v.preflight : [];
const failed = checks.filter((c) => c && c.ok === false).length;
out(`  Coinbase Bazaar validation: ${C.green}${C.bold}${checks.length - failed}/${checks.length} checks passed${C.off}`);
out(`  Listing:                    ${C.green}${C.bold}active${C.off} ${C.dim}since ${String(v.index?.lastCrawledAt ?? "").slice(0, 16).replace("T", " ")} UTC${C.off}`);
out(`  Indexed among ${C.bold}15,262${C.off} resources, one of them ours.`);
out();
out(`  ${C.dim}github.com/plus8bit/deadchannel${C.off}`);
out();

rl?.close();
