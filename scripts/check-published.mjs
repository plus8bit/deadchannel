#!/usr/bin/env node
/**
 * What npm is serving, against what the endpoint actually charges.
 *
 * Every price guard in this repo reads the working tree, and the working tree
 * has been right for days. The published tarballs were not: hosaka-mcp@0.3.0
 * told agents a dossier costs $0.04 while the challenge asked $0.20, because a
 * price change rebuilds the bundle locally and nobody republishes it. A local
 * test cannot see that. This one downloads what a buyer downloads.
 *
 *   node scripts/check-published.mjs
 *
 * Exits non-zero when a published file quotes a price the shop does not charge.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Each package, and the shop whose prices its text is allowed to quote. */
const PACKAGES = [
  { name: "hosaka-mcp", wellKnown: "https://hosaka-agents.vercel.app/.well-known/x402" },
  {
    name: "deadchannel-mcp",
    // deadchannel publishes no catalog document, so ask the endpoint itself.
    challenge: { url: "https://deadchannel.vercel.app/probe", body: { url: "https://example.com" } },
  },
];

async function livePrices(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const doc = await res.json();
  const prices = new Map();
  for (const r of doc.resources ?? []) {
    const amount = Number(r.accepts?.[0]?.amount);
    const href = typeof r.resource === "string" ? r.resource : r.resource?.url;
    if (Number.isFinite(amount) && href) prices.set(new URL(href).pathname, amount / 1e6);
  }
  return prices;
}

function filesOf(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesOf(full));
    else if (/\.(mjs|js|json|md)$/.test(entry)) out.push(full);
  }
  return out;
}

async function challengePrice({ url, body }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const header = res.headers.get("payment-required");
  if (!header) throw new Error(`${url} did not challenge for payment (${res.status})`);
  const doc = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  return new Map([[new URL(url).pathname, Number(doc.accepts[0].amount) / 1e6]]);
}

/**
 * Comments carry supplier costs and the prices competitors charge, which are
 * not ours to match, and an outputExample carries the price of whatever the
 * tool was pointed at. Only what the package says about itself is checked.
 */
function speech(file, text) {
  if (file.endsWith(".md")) return text;
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return dropExamples(stripped);
}

function dropExamples(text) {
  let out = "";
  let i = 0;
  for (;;) {
    const at = text.indexOf("outputExample", i);
    if (at === -1) return out + text.slice(i);
    const open = text.indexOf("{", at);
    if (open === -1) return out + text.slice(i);
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) break;
    }
    out += text.slice(i, at);
    i = j + 1;
  }
}

let bad = 0;
for (const pkg of PACKAGES) {
  const prices = pkg.wellKnown ? await livePrices(pkg.wellKnown) : await challengePrice(pkg.challenge);
  const charged = new Set([...prices.values()].map((n) => n.toFixed(4)));
  const dir = mkdtempSync(join(tmpdir(), "pub-"));
  execFileSync("npm", ["pack", pkg.name], { cwd: dir, stdio: "ignore" });
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  execFileSync("tar", ["xzf", tgz], { cwd: dir });

  const version = JSON.parse(readFileSync(join(dir, "package", "package.json"), "utf8")).version;
  const quoted = new Map();
  for (const file of filesOf(join(dir, "package"))) {
    const text = speech(file, readFileSync(file, "utf8"));
    // Two shapes: a price written out for a reader, and the constant a tool
    // description interpolates. The second is the dangerous one, because it is
    // what the agent is told at the moment it decides whether it can afford us.
    const found = [
      ...[...text.matchAll(/\$(\d+\.\d+)/g)].map((m) => m[1]),
      ...[...text.matchAll(/(?:PRICE_[A-Z_]+|priceUsd)\s*[:=]\s*([0-9][0-9.e-]*)/g)].map((m) => m[1]),
    ];
    for (const raw of found) {
      const usd = Number(raw).toFixed(4);
      if (!quoted.has(usd)) quoted.set(usd, file.slice(dir.length + 9));
    }
  }

  const drift = [...quoted].filter(([usd]) => !charged.has(usd));
  const shop = new URL(pkg.wellKnown ?? pkg.challenge.url).host;
  console.log(`\n${pkg.name}@${version} vs ${shop}`);
  console.log(`  charges: ${[...prices].map(([p, v]) => `${p} $${v}`).join(", ")}`);
  if (drift.length === 0) {
    console.log("  every price it quotes is a price the shop charges");
  } else {
    for (const [usd, file] of drift) console.log(`  quotes $${usd} — no shelf at that price (${file})`);
    bad += drift.length;
  }
}

if (bad > 0) {
  console.log(`\n${bad} published price${bad === 1 ? "" : "s"} the shop does not charge. Republish.`);
  process.exit(1);
}
