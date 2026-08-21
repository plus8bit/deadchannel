#!/usr/bin/env node
/**
 * Collects Voice Memos exports into the numbered takes the video build expects.
 *
 * Voice Memos names its files "New Recording", "New Recording 2", … which sorts
 * lexically as 1, 10, 11, 2 — so ordering is parsed from the trailing number,
 * with the unnumbered first recording treated as take one.
 *
 *   node scripts/import-takes.mjs [source-dir]
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join } from "node:path";
import { homedir } from "node:os";

const SRC = process.argv[2] ?? join(homedir(), "Desktop", "deadchannel-voice");
const DEST = "/tmp/vid/mine";
const AUDIO = new Set([".m4a", ".wav", ".mp3", ".aiff", ".aifc", ".caf", ".mp4"]);
const EXPECTED = 15;

if (!existsSync(SRC)) {
  process.stderr.write(`no such folder: ${SRC}\n`);
  process.exit(1);
}

/** Trailing number in the name; an unnumbered recording is the first one. */
function order(name) {
  const stem = name.slice(0, name.length - extname(name).length);
  const m = /(\d+)\s*$/.exec(stem);
  return m ? Number(m[1]) : 1;
}

const files = readdirSync(SRC)
  .filter((f) => AUDIO.has(extname(f).toLowerCase()) && !f.startsWith("."))
  .map((f) => ({ f, n: order(f) }))
  .sort((a, b) => a.n - b.n || a.f.localeCompare(b.f));

if (files.length === 0) {
  process.stderr.write(`no audio files in ${SRC}\n`);
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

const duration = (p) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).toString().trim());

let total = 0;
files.forEach(({ f }, i) => {
  const target = join(DEST, `${String(i + 1).padStart(2, "0")}${extname(f).toLowerCase()}`);
  copyFileSync(join(SRC, f), target);
  const d = duration(target);
  total += d;
  process.stdout.write(`  ${String(i + 1).padStart(2)}. ${d.toFixed(1).padStart(5)}s  ${f}\n`);
});

process.stdout.write(`\n${files.length} takes, ${total.toFixed(1)}s of narration\n`);
if (files.length !== EXPECTED) {
  process.stdout.write(`\nExpected ${EXPECTED}. Line numbers after the gap will be misaligned —\ncheck the order against data/pitch-script.txt before building.\n`);
}
