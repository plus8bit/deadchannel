#!/usr/bin/env node
/**
 * Renders the pitch video: a narrated terminal session.
 *
 * A static page is a poor demo for a product whose interesting moment is a
 * payment, so the video shows the tool running against real endpoints instead.
 * Frames are HTML screenshots timed to the narration, which means the pacing
 * follows the voice rather than the other way round.
 *
 *   node scripts/build-pitch-video.mjs
 *   ENGINE=files node scripts/build-pitch-video.mjs                 # human takes
 *   ENGINE=say VOICE=Samantha node scripts/build-pitch-video.mjs   # macOS fallback
 *
 * ENGINE=files reads one clip per line from /tmp/vid/mine/01..15, in any common
 * format. A founder reading their own script beats any synthetic voice in a
 * pitch, accent and all, and per-line clips mean a fluffed sentence costs one
 * retake rather than the whole take.
 *   ffmpeg -y -f concat -safe 0 -i /tmp/vid/audio.txt -c copy /tmp/vid/voice.wav
 *   ffmpeg -y -f concat -safe 0 -i /tmp/vid/concat.txt -i /tmp/vid/voice.wav \
 *     -map 0:v -map 1:a -c:v libx264 -crf 20 -pix_fmt yuv420p -r 30 \
 *     -c:a aac -b:a 192k -shortest data/deadchannel-pitch.mp4
 *
 * Narration uses Piper, a local neural model: free, offline, no account, and
 * markedly less robotic than the macOS system voices. Fetch a voice first:
 *   python3 -m piper.download_voices en_US-ryan-high --data-dir /tmp/vid/voices
 *
 * Frames already on disk are skipped, so an interrupted run resumes, and
 * changing only the voice re-times the existing frames without re-rendering.
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
    say: "Hi. My name is Nick. I built deadchannel.",
    lines: [L("$ npm run demo", G)],
  },
  {
    say: "A.I. agents now pay for A.P.I.s by themselves. They can choose from fifteen thousand paid endpoints.",
    lines: [L(""), RULE, L("1 / 4   AI agents now pay for APIs by themselves.", W_), RULE],
  },
  {
    say: "We checked every single one of them.",
    lines: [L(""), L("  We audited every one of them: 14,979 resources.", W_), L("")],
  },
  {
    say: "Forty percent have no tags. Agents cannot find them by topic.",
    lines: [L("   40.9%  publish no discovery tags, so topic search never finds them", A)],
  },
  {
    say: "Three wallets own eighteen percent of the catalog. They get one call in eighty.",
    lines: [
      L("   18.4%  of the catalog belongs to 3 payout addresses", A),
      L("   1.25%  is the share of demand those three actually receive", A),
    ],
  },
  {
    say: "So an agent here is guessing. With real money.",
    lines: [L(""), L("  An agent picking from this catalog is guessing with real money.", D)],
  },
  {
    say: "This is what an agent cannot see before it pays.",
    lines: [L(""), RULE, L("2 / 4   This is what an agent cannot see before it pays.", W_), RULE, L("")],
  },
  {
    say: "This one is the official example. It works only on testnet. Real money cannot go there.",
    lines: [
      L("  TESTNET   risk  80  $0.01         the official reference endpoint", A),
      L("            Only testnet networks offered. This endpoint cannot accept real value.", D),
      L("            https://x402.org/protected", D),
      L(""),
    ],
  },
  {
    say: "This one is a real paid A.P.I. It works. But it has no schema. You pay first. You learn later.",
    lines: [
      L("  LIVE      risk  10  $0.007        a real, widely used paid API", G),
      L("            No serviceName or tags published. Agents searching by topic will not find it.", D),
      L("            https://api.exa.ai/search", D),
    ],
  },
  {
    say: "Our service answers this question. It also checks itself.",
    lines: [L(""), RULE, L("3 / 4   Our service answers that question. It grades itself too.", W_), RULE, L("")],
  },
  {
    say: "This is deadchannel. Live on Base mainnet. Zero risk on our own thirteen checks.",
    lines: [
      L("  LIVE      risk   0  $0.001        deadchannel, live on Base mainnet", G),
      L("            https://deadchannel.vercel.app/probe", D),
      L(""),
    ],
  },
  {
    say: "An agent pays one tenth of a cent. And gets this answer before it commits.",
    lines: [
      L("  An agent pays $0.001 in USDC and gets this verdict before it commits.", D),
      L("  We settle only when the check produced a result. A failure costs the buyer nothing.", D),
    ],
  },
  {
    say: "We take money only when the check gives a result. If we fail, the buyer pays nothing.",
    lines: [L(""), RULE, L("4 / 4   And this is Coinbase checking us, not us checking ourselves.", W_), RULE, L("")],
  },
  {
    say: "And this is Coinbase checking us. Not us checking ourselves.",
    lines: [
      L("  Coinbase Bazaar validation: 25/25 checks passed", G),
      L("  Listing:                    active", G),
      L("  Indexed among 15,262 resources, one of them ours.", W_),
    ],
  },
  {
    say: "Twenty five checks out of twenty five. We are live in their Bazaar. Thank you.",
    lines: [L(""), L("  github.com/plus8bit/deadchannel", A), L("")],
    hold: 1.6,
  },
];

/**
 * Narration engine. `piper` is a local neural model — free, offline, and far
 * less robotic than the system voices; `say` is the macOS fallback.
 */
const ENGINE = process.env.ENGINE ?? "piper";
const VOICE = process.env.VOICE ?? (ENGINE === "piper" ? "/tmp/vid/voices/en_US-ryan-high.onnx" : "Samantha");
const RATE = process.env.RATE ?? "168";
const LENGTH = process.env.LENGTH ?? "1.06";   // >1 slows piper down a little

function speak(text, aiff, wav, index) {
  if (ENGINE === "files") {
    // A human recording, one clip per line. Timing follows the take, so a
    // slow sentence simply holds its frame longer — no re-cutting needed.
    const stem = `${OUT}/mine/${String(index + 1).padStart(2, "0")}`;
    const src = [".m4a", ".mp3", ".wav", ".aiff", ".mp4"].map((e) => stem + e).find((f) => existsSync(f));
    if (!src) throw new Error(`missing recording for line ${index + 1}: expected ${stem}.m4a`);
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error", "-i", src,
      "-af", "highpass=f=80,afftdn=nf=-24,dynaudnorm=g=7:p=0.9,alimiter=limit=0.95",
      "-ar", "48000", "-ac", "2", wav,
    ]);
    return;
  }
  if (ENGINE === "piper") {
    execFileSync(
      "python3",
      ["-m", "piper", "-m", VOICE, "--length-scale", LENGTH, "--sentence-silence", "0.30", "-f", wav],
      { input: text, stdio: ["pipe", "pipe", "pipe"] },
    );
    return;
  }
  execFileSync("say", ["-v", VOICE, "-r", RATE, "-o", aiff, text]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "48000", "-ac", "2", wav]);
}

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
console.log(`engine: ${ENGINE}  voice: ${VOICE}`);
const timeline = [];
let buffer = [];
let frameNo = 0;

for (const [i, sc] of scenes.entries()) {
  const aiff = `${OUT}/audio/${String(i).padStart(2, "0")}.aiff`;
  const wav = `${OUT}/audio/${String(i).padStart(2, "0")}.wav`;
  speak(sc.say, aiff, wav, i);
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
