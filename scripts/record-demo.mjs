#!/usr/bin/env node
/**
 * Records the demo: an agent checks a stranger before paying it, then buys.
 *
 * Everything on screen is produced by running the published packages against
 * live endpoints — the same tarballs a stranger installs from npm, spoken to
 * over stdio exactly as a client speaks to them. Nothing is staged, which is
 * the only property that makes a demo worth showing to people who can check.
 *
 * Two phases, on purpose. Capture spends money and needs the key; render does
 * not, so the film can be recut a hundred times from one paid session.
 *
 *   node scripts/record-demo.mjs capture   # prompts for the key, ~$0.007
 *   node scripts/record-demo.mjs render    # frames and mp4 from the capture
 *   node scripts/record-demo.mjs           # both
 *
 * The key is prompted for with the echo off and passed to the child process in
 * its environment, never on a command line where `ps` would show it.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolved from this file, so the recording works from any directory. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const OUT = process.env.DEMO_OUT ?? "/tmp/x402-demo";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = 1600;
const H = 900;
const FPS = 30;

/** Two strangers from the public catalog. What they are is for the probe to say. */
const FIRST = process.env.DEMO_FIRST ?? "https://spawnxchange-api-485602182462.europe-west4.run.app";
const SECOND = process.env.DEMO_SECOND ?? "https://stableenrich.dev/api/exa/search";
const DOMAIN = process.env.DEMO_DOMAIN ?? "x.com";
const WALLET_OF = "0x70a08231000000000000000000000000";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** The paying wallet's USDC balance, read from the chain rather than counted. */
async function balanceOf(address) {
  const res = await fetch("https://base-rpc.publicnode.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [
      { to: USDC, data: WALLET_OF + address.slice(2).toLowerCase() }, "latest"] }),
  });
  const { result } = await res.json();
  return Number(BigInt(result ?? "0x0")) / 1e6;
}

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
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

/** Speaks MCP to one of our published bundles and returns each tool result. */
function talk(bundle, env, calls) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [join(ROOT, bundle)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const results = [];
    let buffer = "";
    let sent = 0;

    const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
    send({ jsonrpc: "2.0", id: 0, method: "initialize", params: {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "demo", version: "1" } } });

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 0) {
          send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: calls[0] });
          sent = 1;
          continue;
        }
        const text = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error ?? msg.result);
        results.push({ call: calls[sent - 1], startedAt: Date.now(), text });
        if (sent < calls.length) {
          send({ jsonrpc: "2.0", id: sent + 1, method: "tools/call", params: calls[sent] });
          sent += 1;
        } else {
          child.stdin.end();
          resolve(results);
        }
      }
    });
    child.stderr.on("data", (c) => process.stderr.write(c));
    child.on("error", reject);
    child.on("exit", () => resolve(results));
  });
}

async function capture() {
  const key = process.env.DEMO_KEY ?? (await promptHidden("private key of the paying wallet (hidden): "));
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key.trim())) {
    process.stderr.write("that is not a 0x-prefixed 32-byte hex key. Nothing was recorded.\n");
    process.exit(1);
  }
  const k = key.trim();
  mkdirSync(OUT, { recursive: true });

  process.stdout.write("running deadchannel…\n");
  const { privateKeyToAccount } = await import("viem/accounts");
  const address = privateKeyToAccount(k).address;
  const before = await balanceOf(address);

  const dc = await talk("packages/deadchannel-mcp/src/server.mjs", { DEADCHANNEL_PRIVATE_KEY: k }, [
    { name: "deadchannel_health", arguments: {} },
    { name: "deadchannel_probe", arguments: { url: FIRST } },
    { name: "deadchannel_probe", arguments: { url: SECOND } },
  ]);

  process.stdout.write("running hosaka…\n");
  const hs = await talk("packages/hosaka-mcp/src/server.mjs", { HOSAKA_PRIVATE_KEY: k }, [
    { name: "hosaka_dossier", arguments: { domain: DOMAIN } },
  ]);
  const after = await balanceOf(address);

  const steps = [...dc, ...hs];
  writeFileSync(`${OUT}/session.json`, JSON.stringify(
    { recordedAt: new Date().toISOString(), address, before, after, steps }, null, 2));
  process.stdout.write(`\nwallet ${before.toFixed(6)} → ${after.toFixed(6)} (${(before - after).toFixed(6)} spent)\n`);

  // Printed rather than assumed: a step that failed still renders, and a film
  // of error messages is worse than no film.
  process.stdout.write(`\ncaptured ${steps.length} steps → ${OUT}/session.json\n`);
  let bad = 0;
  for (const s of steps) {
    const ok = !/error|not set|must be|failed/i.test(s.text.slice(0, 160));
    if (!ok) bad += 1;
    process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${s.call.name.padEnd(20)} ${s.text.slice(0, 88).replace(/\s+/g, " ")}\n`);
  }
  if (bad > 0) process.stdout.write(`\n${bad} step(s) failed — fix before rendering.\n`);
}

export { capture };

// ── the film ────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Trims a JSON answer to what a viewer can actually read in a few seconds.
 *
 * A full dossier is forty lines nobody pauses to read. The fields kept are the
 * ones the claim rests on, and the count of what was dropped stays visible so
 * the trim never reads as a smaller answer than was really bought.
 */
/**
 * Colours a value by what it says, never by what the scene wanted it to say.
 *
 * The first cut of this film painted a verdict red because the scene was
 * captioned as a warning — and the endpoint came back clean, so the frame
 * showed "live · risk 0" in the colour of danger. A tool that reports on
 * strangers cannot afford a demo that misreports one.
 */
/**
 * Says what the probe found, in the probe's own terms.
 *
 * The first film had captions written before the endpoints were checked, and
 * one of them called a clean result a bad listing. A caption chosen from the
 * verdict cannot disagree with the frame it sits under, whatever comes back.
 */
/** CAIP-2 identifiers are for machines; a caption is read by people. */
const NET_NAMES = {
  "base": "Base", "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia", "base-sepolia": "Base Sepolia",
  "eip155:80002": "Polygon Amoy, a testnet", "eip155:11155111": "Sepolia, a testnet",
  "eip155:421614": "Arbitrum Sepolia, a testnet",
  "eip155:137": "Polygon", "eip155:42161": "Arbitrum",
  "aws:base": "a brokered rail",
};
const netName = (n) => NET_NAMES[n] ?? (String(n).startsWith("solana:") ? "Solana" : String(n));

function verdictCaption(text) {
  let o;
  try { o = JSON.parse(text); } catch { return "The check could not read this endpoint."; }
  const risk = Number(o.risk ?? 0);
  const problems = (o.problems ?? []).length;
  const nets = (o.networks ?? []).map(netName).join(", ");
  switch (o.verdict) {
    case "live":
      return risk === 0
        ? `Clean. Every check passed, and it settles on ${nets || "a public chain"}.`
        : `Live, with ${problems} finding${problems === 1 ? "" : "s"} the listing does not mention.`;
    case "testnet":
      return `Listed in the mainnet catalog. It settles on ${nets || "a testnet"}, where the money is not real.`;
    case "degraded":
      return `It answers, but ${problems} check${problems === 1 ? "" : "s"} did not pass.`;
    case "trap":
      return "It takes the payment and returns nothing worth having.";
    case "dead":
      return "Still listed for sale. It does not answer at all.";
    default:
      return `Verdict: ${String(o.verdict)}.`;
  }
}

function toneOf(k, v) {
  if (k === "verdict") return { live: "good", degraded: "warn" }[String(v)] ?? "bad";
  if (k === "risk") { const n = Number(v); return n <= 20 ? "good" : n <= 50 ? "warn" : "bad"; }
  return "";
}

function digest(text, keys) {
  let obj;
  try { obj = JSON.parse(text); } catch { return [{ t: text.slice(0, 400) }]; }
  const lines = [];
  // Omitting the list means every field, in the order the answer gave them.
  const wanted = keys ?? Object.keys(obj);
  for (const k of wanted) {
    if (obj[k] === undefined) continue;
    const v = obj[k];
    // The findings are the part a viewer actually reads, so they get a line
    // each rather than being flattened into one unreadable JSON string.
    if (k === "vendors" && Array.isArray(v)) {
      // The evidence column is the whole product, so it gets its own row and
      // is never shortened: a vendor list without proof is a guess.
      for (const ven of v) {
        lines.push({ vendor: ven.name ?? "?", cat: ven.category ?? "", proof: ven.evidence ?? "" });
      }
      continue;
    }
    if (k === "registration" && v && typeof v === "object") {
      const reg = v.value ?? v;
      lines.push({ k: "registered", v: `${reg.ageYears ?? "?"} years ago · ${reg.registrar ?? "unknown registrar"}` });
      continue;
    }
    if (k === "gaps" && Array.isArray(v)) {
      lines.push({ k: "gaps", v: v.length === 0 ? "none" : v.join(", "), tone: v.length === 0 ? "good" : "warn" });
      continue;
    }
    if (k === "problems" && Array.isArray(v)) {
      for (const p of v) {
        const mark = p.status === "fail" ? "✗" : p.status === "warn" ? "!" : "·";
        lines.push({ k: mark, v: p.detail ?? p.id ?? "", tone: p.status === "fail" ? "bad" : p.status === "warn" ? "warn" : "" });
      }
      continue;
    }
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    lines.push({ k, v: val, tone: toneOf(k, val) });
  }
  return lines;
}

function page(scene) {
  const rows = scene.rows.map((r) => {
    if (r.gap) return `<div class="gap"></div>`;
    if (r.head) return `<div class="head">${esc(r.head)}</div>`;
    if (r.cmd) return `<div class="cmd"><span class="pr">›</span> ${esc(r.cmd)}</div>`;
    if (r.dim) return `<div class="dim">${esc(r.dim)}</div>`;
    if (r.vendor) {
      return `<div class="ven"><span class="vn">${esc(r.vendor)}</span>` +
        `<span class="vc">${esc(r.cat)}</span><span class="vp">${esc(r.proof)}</span></div>`;
    }
    if (r.k) {
      const mark = r.k === "✗" || r.k === "!" || r.k === "·" ? " mark" : "";
      return `<div class="kv${mark}"><span class="k">${esc(r.k)}</span><span class="v ${r.tone ?? ""}">${esc(r.v)}</span></div>`;
    }
    return `<div class="t">${esc(r.t ?? "")}</div>`;
  }).join("");

  return `<!doctype html><meta charset="utf-8"><body class="${scene.dense ? "dense" : ""}"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${W}px;height:${H}px;background:#07090D;color:#C9D3DD;
       font:400 27px/1.5 "SF Mono",Menlo,monospace;overflow:hidden}
  .wrap{padding:52px 64px 0}
  .bar{display:flex;justify-content:space-between;align-items:baseline;
       border-bottom:1px solid #1B222C;padding-bottom:18px;margin-bottom:34px}
  .title{font-size:25px;color:#7C8896;letter-spacing:.16em;text-transform:uppercase}
  .spend{font-size:25px;color:#E8442A;letter-spacing:.05em}
  .head{color:#F2F6FA;font-size:31px;margin:0 0 22px}
  .cmd{color:#8FE3B0;margin:6px 0}
  .pr{color:#3E4A57}
  .t{color:#C9D3DD;margin:4px 0}
  .dim{color:#5A6672;margin:4px 0;font-size:24px}
  .kv{display:flex;margin:5px 0}
  .k{color:#6E7A88;width:250px;flex:none}
  .kv.mark .k{width:56px;color:#5A6672}
  .v{color:#E6ECF2}
  .v.bad{color:#FF6B57}.v.good{color:#7BE39B}.v.warn{color:#FFC46B}
  .gap{height:22px}
  .ven{display:flex;margin:3px 0;align-items:baseline}
  .vn{color:#F2F6FA;width:230px;flex:none;white-space:nowrap}
  .vc{color:#6E7A88;width:230px;flex:none;font-size:23px}
  .vp{color:#8FE3B0;font-size:23px}
  body.dense{font-size:24px;line-height:1.42}
  body.dense .vn{width:280px}body.dense .vc{width:190px;font-size:21px;white-space:nowrap}body.dense .vp{font-size:21px}
  .cap{position:absolute;left:0;right:0;bottom:0;padding:30px 64px;
       background:#0B0F15;border-top:1px solid #1B222C;color:#9FB0C0;font-size:28px}
  </style><div class="wrap"><div class="bar">
    <div class="title">${esc(scene.title)}</div><div class="spend">${esc(scene.spend)}</div>
  </div>${rows}</div><div class="cap">${esc(scene.caption)}</div>`;
}

function render() {
  const session = JSON.parse(readFileSync(`${OUT}/session.json`, "utf8"));
  const step = (name, i = 0) => session.steps.filter((s) => s.call.name === name)[i];
  const health = step("deadchannel_health");
  const dead = step("deadchannel_probe", 0);
  const live = step("deadchannel_probe", 1);
  const bought = step("hosaka_dossier");

  const PROBE = 0.001;
  const DOSSIER = 0.04;
  const money = (n) => `spent: $${n.toFixed(3)}`;
  const scenes = [];
  const scene = (title, spend, caption, rows, hold, dense = false) =>
    scenes.push({ title, spend, caption, rows, hold, dense });

  scene("deadchannel", money(0),
    "An agent with a wallet can pay anyone. Nothing tells it who.",
    [{ head: "Check an x402 endpoint before you pay it." },
     { t: "verdict · risk score · the specific problems found" }, { gap: 1 },
     { dim: "$0.001 in USDC on Base. Less than the smallest payment it protects." }], 3.6);

  scene("install", money(0), "One line in the MCP config. No signup, no API key, no account.",
    [{ head: "claude_desktop_config.json" }, { gap: 1 },
     { t: '"deadchannel": {' }, { t: '  "command": "npx",' },
     { t: '  "args": ["-y", "deadchannel-mcp"],' },
     { t: '  "env": { "DEADCHANNEL_PRIVATE_KEY": "0x…" }' }, { t: "}" }, { gap: 1 },
     { dim: "The key signs locally and never leaves the machine." }], 5.4);

  scene("health", money(0), "Free, and needs no wallet: is the service up, or is my key wrong?",
    [{ cmd: "deadchannel_health" }, { gap: 1 }, ...digest(health?.text ?? "{}")], 3.6);

  scene("probe · a stranger from the catalog", money(PROBE), verdictCaption(dead?.text ?? "{}"),
    [{ cmd: `deadchannel_probe  ${FIRST.replace("https://", "").slice(0, 58)}` }, { gap: 1 },
     ...digest(dead?.text ?? "{}", ["verdict", "risk", "priceUsd", "networks", "checksPassed", "checksRun", "problems"])], 8.0);

  scene("probe · the busiest data seller in the catalog", money(PROBE * 2), verdictCaption(live?.text ?? "{}"),
    [{ cmd: `deadchannel_probe  ${SECOND.replace("https://", "")}` }, { gap: 1 },
     ...digest(live?.text ?? "{}", ["verdict", "risk", "priceUsd", "networks", "checksPassed", "checksRun", "problems"])], 8.0);

  scene(`buy · every vendor ${DOMAIN} can be proven to use`, money(PROBE * 2 + DOSSIER),
    "Not a guess. Each line carries the DNS record or loaded script that proves it.",
    [{ cmd: `hosaka_dossier  ${DOMAIN}` }, { gap: 1 },
     ...digest(bought?.text ?? "{}", ["vendors", "registration", "gaps"])], 12.0, true);

  scene("the whole session", money(PROBE * 2 + DOSSIER),
    "Three payments, no invoice, no account, no subscription. Settled on Base.",
    [{ head: `$${(PROBE * 2 + DOSSIER).toFixed(3)} total` }, { gap: 1 },
     { k: "2 × probe", v: `$${(PROBE * 2).toFixed(3)}` },
     { k: "1 × dossier", v: `$${DOSSIER.toFixed(2)}` },
     { k: "wallet", v: `$${(session.before ?? 0).toFixed(6)}  →  $${(session.after ?? 0).toFixed(6)}` }, { gap: 1 },
     { dim: "npm i -g deadchannel-mcp   ·   npm i -g hosaka-mcp" },
     { dim: "deadchannel.vercel.app   ·   hosaka-agents.vercel.app" }], 7.0);

  // Cleared rather than reused: frames were cached to make an interrupted
  // render resumable, but a second capture into the same directory would then
  // stitch new data onto old pictures, which is a worse failure than a slow
  // rebuild — and an invisible one.
  rmSync(`${OUT}/frames`, { recursive: true, force: true });
  mkdirSync(`${OUT}/frames`, { recursive: true });
  const timeline = [];
  let n = 0;
  for (const s of scenes) {
    // Rows appear one at a time so the eye can follow, then the finished scene
    // is held long enough to read the part that matters.
    const per = 0.16;
    for (let i = 1; i <= s.rows.length; i++) {
      timeline.push({ n: n++, html: page({ ...s, rows: s.rows.slice(0, i) }), dur: per });
    }
    timeline.push({ n: n++, html: page(s), dur: Math.max(1, s.hold - s.rows.length * per) });
  }

  writeFileSync(`${OUT}/concat.txt`,
    timeline.map((t) => `file '${OUT}/frames/f${String(t.n).padStart(4, "0")}.png'\nduration ${t.dur.toFixed(3)}`).join("\n") +
      `\nfile '${OUT}/frames/f${String(timeline[timeline.length - 1].n).padStart(4, "0")}.png'\n`);

  process.stdout.write(`rendering ${timeline.length} frames…\n`);
  for (const t of timeline) {
    const f = `${OUT}/frames/f${String(t.n).padStart(4, "0")}`;
    if (existsSync(`${f}.png`)) continue;
    writeFileSync(`${f}.html`, t.html);
    execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars",
      `--window-size=${W},${H}`, "--default-background-color=07090D",
      "--virtual-time-budget=250", `--screenshot=${f}.png`, `file://${f}.html`], { stdio: "pipe" });
    process.stdout.write(`\r  ${t.n + 1}/${timeline.length}`);
  }
  process.stdout.write("\n");

  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", `${OUT}/concat.txt`,
    "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-vf", `scale=${W}:${H}`, `${OUT}/demo.mp4`], { stdio: "pipe" });
  const secs = timeline.reduce((a, t) => a + t.dur, 0);
  process.stdout.write(`${OUT}/demo.mp4 — ${secs.toFixed(1)}s\n`);

  // Onto the desktop, because a file in /tmp is a file nobody drags into a post.
  const desktop = `${process.env.HOME}/Desktop/deadchannel-demo.mp4`;
  try {
    execFileSync("cp", [`${OUT}/demo.mp4`, desktop]);
    process.stdout.write(`copied to ${desktop}\n`);
  } catch { /* a missing Desktop is not a reason to lose the render */ }
}

const mode = process.argv[2];
if (mode !== "render") await capture();
if (mode !== "capture") render();
