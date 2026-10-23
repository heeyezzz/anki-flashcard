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
  // 两个输入：均匀的安静音（普通词条），以及带尖峰的音（divine / packing list 那种被峰值顶住的）。
  const make = async (name, lavfi, filter) => {
    const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", lavfi];
    if (filter) args.push("-af", filter);
    await run("ffmpeg", [...args, "-c:a", "libmp3lame", "-b:a", "128k", "-y", join(dir, name)]);
    return readFile(join(dir, name));
  };
  const cases = [
    { name: "安静均匀", sample: await make("flat.mp3", "sine=frequency=440:duration=2", "volume=-14dB") },
    // 10ms 满幅脉冲 + 很轻的主体：峰值远高于主体，loudnorm 单段会被真峰值卡在 -19 左右抬不动。
    { name: "带尖峰", sample: await make("peaky.mp3", "aevalsrc='if(lt(t,0.01),0.9,0.05*sin(2*PI*440*t))':d=2") }
  ];
  let failed = 0;
  for (const item of cases) {
    const before = await integratedLufs(item.sample, dir, `b-${item.name}.mp3`);
    const shaped = await normalizeLoudness(item.sample);
    if (!shaped.normalized) throw new Error(`归一没有做成：${shaped.reason}`);
    const after = await integratedLufs(shaped.buffer, dir, `a-${item.name}.mp3`);
    const drift = Math.abs(after - YOUDAO_TARGET_LUFS);
    console.log(`${item.name}: ${before.toFixed(1)} → ${after.toFixed(1)} LUFS（目标 ${YOUDAO_TARGET_LUFS}，偏差 ${drift.toFixed(1)}，变响 ${after > before}）`);
    if (drift > 1.5 || after <= before) { console.log(`FAIL ${item.name} 没有落到目标 ±1.5`); failed += 1; }
  }
  if (failed) process.exit(1);
  console.log("PASS 词音响度归一落在例句水位");
} finally {
  await rm(dir, { recursive: true, force: true });
}
