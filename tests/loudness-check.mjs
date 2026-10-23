/**
 * anki-flashcard — loudness regression check (read-only, no network).
 *
 * The card's word clip and its example clip come from two different engines; if their loudness
 * differs by a few dB the learner hears the word as "quieter" on the same device volume. This checks
 * that normalizeLoudness pulls a quiet input to the MiniMax example level (-16 LUFS ± 1.5) without
 * touching the network: a sine tone stands in for the dictionary clip.
 *
 * Prints SKIP when ffmpeg is unavailable — normalization is a graceful-degradation feature by design.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { normalizeLoudness, YOUDAO_TARGET_LUFS } from "../scripts/youdao-tts.mjs";

const run = promisify(execFile);

/** Integrated loudness of a buffer, via a temp file (pipe:0/pipe:1 wedges ffmpeg on this machine). */
const integratedLufs = async (buffer, dir, name) => {
  const path = join(dir, name);
  await writeFile(path, buffer);
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  return Number(stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/)[1]);
};

try {
  await run("ffmpeg", ["-version"]);
} catch (_) {
  console.log("SKIP 本机没有 ffmpeg：响度归一按设计跳过，词音保持原样");
  process.exit(0);
}

const dir = await mkdtemp(join(tmpdir(), "anki-loudnorm-test-"));
try {
  // -20 dBFS 的安静输入，模拟词典录音比例句轻 4–5 dB 的那种落差。
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "sine=frequency=440:duration=2", "-af", "volume=-14dB", "-c:a", "libmp3lame", "-b:a", "128k",
    "-y", join(dir, "quiet.mp3")]);
  const raw = await readFile(join(dir, "quiet.mp3"));
  const before = await integratedLufs(raw, dir, "before.mp3");
  const shaped = await normalizeLoudness(raw);
  if (!shaped.normalized) throw new Error(`归一没有做成：${shaped.reason}`);
  const after = await integratedLufs(shaped.buffer, dir, "after.mp3");
  const drift = Math.abs(after - YOUDAO_TARGET_LUFS);
  console.log(JSON.stringify({ before, after, target: YOUDAO_TARGET_LUFS, drift: Number(drift.toFixed(1)), louder: after > before }));
  if (drift > 1.5 || after <= before) {
    console.log(`FAIL 归一后 ${after} LUFS 没落到目标 ${YOUDAO_TARGET_LUFS} ±1.5，或没有变响`);
    process.exit(1);
  }
  console.log("PASS 词音响度归一落在例句水位");
} finally {
  await rm(dir, { recursive: true, force: true });
}
