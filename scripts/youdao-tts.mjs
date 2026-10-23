/**
 * anki-flashcard — 有道词典的词条录音，只用于**单词/短语发音**。
 *
 * 这是词典接口，不是文本转语音：只有它收录的词条有音频。实测单词与短语词条（`spite`、
 * `comply with`、`in spite of`）都返回 MP3，而任意句子一律 500 `returned null audio`，
 * 13 个字符的 "She trembled." 也一样。所以例句音频必须继续走 MiniMax。
 *
 * 非官方端点：没有 SLA，可能限流或改接口。拉不到就抛错，绝不静默改用付费合成。
 * 自用可以，不要把抓下来的音频公开分发。
 *
 * 响度：词典录音彼此差到 5 dB，且比 MiniMax 例句轻约 4.7 dB（实测 -21.6 vs -16.9 LUFS），
 * 同一台手机上点单词和点例句会感觉单词明显小。所以入库前一律过一遍 loudnorm 拉到例句水位。
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const YOUDAO_ENDPOINT = "https://dict.youdao.com/dictvoice";
export const YOUDAO_ACCENTS = { uk: 2, us: 1 };
// -l16 是这份录音的处理版本：文件名指纹含 model，改这个后缀会让旧的原样音频被判为过期并重录。
export const YOUDAO_MODEL = "youdao-dictvoice-l16";
// 目标水位取自 MiniMax 例句的实测值（-15.8 ~ -17.7 LUFS，均值 -16.9）。
export const YOUDAO_TARGET_LUFS = -16;
export const YOUDAO_TARGET_TRUE_PEAK = -1.5;
export const YOUDAO_LOUDNORM = `loudnorm=I=${YOUDAO_TARGET_LUFS}:TP=${YOUDAO_TARGET_TRUE_PEAK}:LRA=11`;

let ffmpegChecked = null;
const hasFfmpeg = async () => {
  if (ffmpegChecked === null) {
    ffmpegChecked = await run("ffmpeg", ["-version"]).then(() => true, () => false);
  }
  return ffmpegChecked;
};

/**
 * EBU R128 响度归一（单遍）：短词条一次过就能压到目标 ±0.5 LU 内，不值得上两遍。
 * 走临时文件而不是 pipe:0/pipe:1 —— 在本机上那条管道调用会卡死（连 execFile 的 timeout 都收不回）。
 * 没有 ffmpeg 时原样返回并把 normalized 标成 false——响一点不响，不该因此把整轮导入卡住。
 */
export const normalizeLoudness = async (buffer, { af = YOUDAO_LOUDNORM } = {}) => {
  if (!(await hasFfmpeg())) return { buffer, normalized: false, reason: "本机没有 ffmpeg" };
  const dir = await mkdtemp(join(tmpdir(), "anki-loudnorm-"));
  const [src, dst] = [join(dir, "in.mp3"), join(dir, "out.mp3")];
  try {
    await writeFile(src, buffer);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-af", af,
      "-c:a", "libmp3lame", "-b:a", "128k", dst], { timeout: 30_000 });
    const shaped = await readFile(dst);
    if (shaped.length < 1000) throw new Error(`输出过小（${shaped.length} 字节）`);
    return { buffer: shaped, normalized: true };
  } catch (error) {
    return { buffer, normalized: false, reason: `响度归一失败：${String(error.stderr || error.message).trim().slice(0, 80)}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** 归一没做成时不抛错，但必须让调用方在报告里写清楚：这批词音还是原样，会比例句轻。 */
export const noteYoudaoNormalization = (clip, warnings) => {
  if (clip?.normalized === false) {
    warnings.push(`有道词音没有做响度归一（${clip.normalizeNotice || "原因未知"}）：这批录音在卡上会比例句明显偏轻，装好 ffmpeg 后重录即可。`);
  }
};

/** 供 createMediaFilename 用：把口音写进指纹，换口音才会重新录制。 */
export const youdaoVoiceId = (accent) => `youdao-${YOUDAO_ACCENTS[accent] ?? YOUDAO_ACCENTS.uk}`;

/**
 * 单词发音的来源配置。`--word-tts` 的取值映射成 createMediaFilename 需要的一组参数；
 * 例句不受影响，永远走 MiniMax。
 */
export const WORD_TTS_CHOICES = ["youdao", "youdao-us", "minimax"];
export const wordAudioSource = (wordTts, minimax) => {
  if (wordTts === "minimax") {
    return { provider: "minimax", prefix: minimax.mediaPrefix, model: minimax.model, voiceId: minimax.voiceId, speed: minimax.speed };
  }
  const accent = wordTts === "youdao-us" ? "us" : "uk";
  return { provider: "youdao", accent, prefix: `youdao-${accent}`, model: YOUDAO_MODEL, voiceId: youdaoVoiceId(accent), speed: 1 };
};

export async function synthesizeYoudao({ text, accent = "uk", timeoutMs = 20000 } = {}) {
  const word = String(text || "").trim();
  if (!word) throw new Error("有道发音需要一个英文词条，收到空文本。");
  if (!YOUDAO_ACCENTS[accent]) throw new Error(`未知口音 "${accent}"，可选：${Object.keys(YOUDAO_ACCENTS).join("、")}。`);
  const url = `${YOUDAO_ENDPOINT}?audio=${encodeURIComponent(word)}&type=${YOUDAO_ACCENTS[accent]}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`有道发音请求失败（${word}）：${error.name === "TimeoutError" ? `超过 ${timeoutMs}ms` : error.message}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.includes("audio")) {
    const reason = type.includes("json") ? body.toString("utf8").slice(0, 160) : `HTTP ${response.status}`;
    throw new Error(
      `有道没有词条「${word}」的录音：${reason}。`
      + "该端点只返回词典收录词条的音频，句子一律取不到——例句发音请继续用 MiniMax。"
    );
  }
  if (body.length < 1000) throw new Error(`有道返回的音频过小（${body.length} 字节），不像有效录音：${word}`);
  const shaped = await normalizeLoudness(body);
  return { audioBase64: shaped.buffer.toString("base64"), bytes: shaped.buffer.length, normalized: shaped.normalized, normalizeNotice: shaped.reason || null };
}
