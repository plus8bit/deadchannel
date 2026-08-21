#!/usr/bin/env node
/**
 * Renders the pitch video: a narrated terminal session.
 *
 * A static page is a poor demo for a product whose interesting moment is a
 * payment, so the video shows the tool running against real endpoints instead.
 * Frames are HTML screenshots timed to the narration, which means the pacing
 * follows the voice rather than the other way round.
 *
 *   VOICE=Samantha RATE=168 node scripts/build-pitch-video.mjs
 *   ffmpeg -y -f concat -safe 0 -i /tmp/vid/audio.txt -c copy /tmp/vid/voice.wav
 *   ffmpeg -y -f concat -safe 0 -i /tmp/vid/concat.txt -i /tmp/vid/voice.wav \
 *     -map 0:v -map 1:a -c:v libx264 -crf 20 -pix_fmt yuv420p -r 30 \
 *     -c:a aac -b:a 192k -shortest data/deadchannel-pitch.mp4
 *
 * Frames already on disk are skipped, so an interrupted run resumes. Voices
 * come from `say -v '?'`; changing VOICE regenerates only the narration.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const OUT = "/tmp/vid";
const W = 1920, H = 1080;
const VISIBLE = 22;          // terminal lines on screen
const REVEAL = 0.32;         // seconds per revealed line
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const A = "amber", G = "green", D = "dim", R = "red", W_ = "white", C = "cyan";
const L = (t, c = W_) => ({ t, c });
const RULE = L("─".repeat(74), D);

/** Each scene: what the narrator says, and what appears on screen while they say it. */
const scenes = [
  {
    say: "Hi. I am Nick, and I built deadchannel.",
    lines: [L("$ npm run demo", G)],
  },
  {
    say: "A. I. agents now pay for A P Is by themselves. Fifteen thousand paid endpoints are on offer.",
    lines: [L(""), RULE, L("1 / 4   AI agents now pay for APIs by themselves.", W_), RULE],
  },
  {
    say: "We checked every single one of them.",
    lines: [L(""), L("  We audited every one of them: 14,979 resources.", W_), L("")],
  },
  {
    say: "Forty percent publish no tags at all. An agent searching by topic will never find them.",
    lines: [L("   40.9%  publish no discovery tags, so topic search never finds them", A)],
  },
  {
    say: "And three wallets own eighteen percent of the whole catalog. They receive one call in eighty.",
    lines: [
      L("   18.4%  of the catalog belongs to 3 payout addresses", A),
      L("   1.25%  is the share of demand those three actually receive", A),
    ],
  },
  {
    say: "An agent picking from this catalog is guessing, with real money.",
    lines: [L(""), L("  An agent picking from this catalog is guessing with real money.", D)],
  },
  {
    say: "Here is what an agent cannot see before it pays.",
    lines: [L(""), RULE, L("2 / 4   This is what an agent cannot see before it pays.", W_), RULE, L("")],
  },
  {
    say: "This is the official reference endpoint. It only works on testnet. Real money cannot go there.",
    lines: [
      L("  TESTNET   risk  80  $0.01         the official reference endpoint", A),
      L("            Only testnet networks offered. This endpoint cannot accept real value.", D),
      L("            https://x402.org/protected", D),
      L(""),
    ],
  },
  {
    say: "And here is a real, widely used paid A P I. It works, but it publishes no schema. You pay first, and learn what you bought after.",
    lines: [
      L("  LIVE      risk  10  $0.007        a real, widely used paid API", G),
      L("            No serviceName or tags published. Agents searching by topic will not find it.", D),
      L("            https://api.exa.ai/search", D),
    ],
  },
  {
    say: "Our service answers that question. It grades itself, too.",
    lines: [L(""), RULE, L("3 / 4   Our service answers that question. It grades itself too.", W_), RULE, L("")],
  },
  {
    say: "This is deadchannel, live on Base mainnet. Zero risk, on our own thirteen checks.",
    lines: [
      L("  LIVE      risk   0  $0.001        deadchannel, live on Base mainnet", G),
      L("            https://deadchannel.vercel.app/probe", D),
      L(""),
    ],
  },
  {
    say: "An agent pays one tenth of a cent in U S D C, and gets this answer before it commits. We charge only when the check gives a result. If we fail, the buyer pays nothing.",
    lines: [
      L("  An agent pays $0.001 in USDC and gets this verdict before it commits.", D),
      L("  We settle only when the check produced a result. A failure costs the buyer nothing.", D),
    ],
  },
  {
    say: "And this is Coinbase checking us. Not us checking ourselves.",
    lines: [L(""), RULE, L("4 / 4   And this is Coinbase checking us, not us checking ourselves.", W_), RULE, L("")],
  },
  {
    say: "Twenty five checks out of twenty five. Our listing is active in their Bazaar, one of fifteen thousand.",
    lines: [
      L("  Coinbase Bazaar validation: 25/25 checks passed", G),
      L("  Listing:                    active", G),
      L("  Indexed among 15,262 resources, one of them ours.", W_),
    ],
  },
  {
    say: "That is deadchannel. Open source, zero dependencies. Thank you.",
    lines: [L(""), L("  github.com/plus8bit/deadchannel", A), L("")],
    hold: 1.6,
  },
];

const VOICE = process.env.VOICE ?? "Samantha";
const RATE = process.env.RATE ?? "168";

rmSync(`${OUT}/audio`, { recursive: true, force: true });
mkdirSync(`${OUT}/frames`, { recursive: true });
mkdirSync(`${OUT}/audio`, { recursive: true });

const COLORS = {
  white: "#E6EAF0", dim: "#6B7280", amber: "#E8873A",
  green: "#6FAE8F", red: "#D4705F", cyan: "#74A6B6",
};

function page(buffer) {
  const rows = buffer.slice(-VISIBLE);
  const body = rows
    .map((l) => `<div class="l" style="color:${COLORS[l.c]}">${l.t.replace(/&/g, "&amp;").replace(/</g, "&lt;") || "&nbsp;"}</div>`)
    .join("");
  return `<!doctype html><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#07090D}
.win{position:absolute;inset:44px;background:#0C0E13;border:1px solid #232936;border-radius:12px;
     box-shadow:0 30px 90px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden}
.bar{height:46px;background:#151A22;border-bottom:1px solid #232936;display:flex;align-items:center;
     padding:0 18px;gap:9px;flex:none}
.dot{width:13px;height:13px;border-radius:50%}
.t{margin-left:16px;color:#7C8697;font:500 15px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.02em}
.scr{flex:1;padding:26px 34px;font:400 25px/1.5 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre;overflow:hidden}
.l{min-height:37px}
</style>
<div class="win">
  <div class="bar">
    <span class="dot" style="background:#E05B4A"></span>
    <span class="dot" style="background:#E3B341"></span>
    <span class="dot" style="background:#5FB87A"></span>
    <span class="t">deadchannel — demo</span>
  </div>
  <div class="scr">${body}</div>
</div>`;
}

// ── narration: synthesize first, so frame timing can follow the voice ────────
console.log(`voice: ${VOICE} @ ${RATE} wpm`);
const timeline = [];
let buffer = [];
let frameNo = 0;

for (const [i, sc] of scenes.entries()) {
  const aiff = `${OUT}/audio/${String(i).padStart(2, "0")}.aiff`;
  const wav = `${OUT}/audio/${String(i).padStart(2, "0")}.wav`;
  execFileSync("say", ["-v", VOICE, "-r", RATE, "-o", aiff, sc.say]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "48000", "-ac", "2", wav]);
  const dur = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav])
      .toString().trim(),
  );

  // Reveal the scene's lines while the voice is talking, then hold on the last frame.
  const reveals = sc.lines.length;
  const revealTime = Math.min(reveals * REVEAL, Math.max(dur - 0.5, 0.3));
  const per = reveals > 0 ? revealTime / reveals : 0;

  for (const line of sc.lines) {
    buffer.push(line);
    timeline.push({ frame: frameNo++, html: page(buffer), dur: per });
  }
  const held = dur - revealTime + (sc.hold ?? 0.45);
  if (held > 0) timeline.push({ frame: frameNo++, html: page(buffer), dur: held });
  console.log(`  scene ${i + 1}/${scenes.length}: ${dur.toFixed(2)}s voice, ${reveals} lines`);
}

// Manifests first: an interrupted render then costs only the frames not yet made.
writeFileSync(
  `${OUT}/concat.txt`,
  timeline.map((t) => `file '${OUT}/frames/f${String(t.frame).padStart(4, "0")}.png'\nduration ${t.dur.toFixed(3)}`).join("\n") +
    `\nfile '${OUT}/frames/f${String(timeline[timeline.length - 1].frame).padStart(4, "0")}.png'\n`,
);
writeFileSync(
  `${OUT}/audio.txt`,
  scenes.map((_, i) => `file '${OUT}/audio/${String(i).padStart(2, "0")}.wav'`).join("\n") + "\n",
);
console.log("total:", timeline.reduce((a, t) => a + t.dur, 0).toFixed(1), "s");

console.log(`rendering ${timeline.length} frames…`);
for (const t of timeline) {
  const f = `${OUT}/frames/f${String(t.frame).padStart(4, "0")}`;
  if (existsSync(`${f}.png`)) continue;
  writeFileSync(`${f}.html`, t.html);
  execFileSync(CHROME, [
    "--headless", "--disable-gpu", "--hide-scrollbars",
    `--window-size=${W},${H}`, "--default-background-color=07090D",
    "--virtual-time-budget=300", `--screenshot=${f}.png`, `file://${f}.html`,
  ], { stdio: "pipe" });
  process.stdout.write(`\r  ${t.frame + 1}/${timeline.length}`);
}
process.stdout.write("\n");
