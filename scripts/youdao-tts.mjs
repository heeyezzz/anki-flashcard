/**
 * anki-flashcard — 有道词典的词条录音，只用于**单词/短语发音**。
 *
 * 这是词典接口，不是文本转语音：只有它收录的词条有音频。实测单词与短语词条（`spite`、
 * `comply with`、`in spite of`）都返回 MP3，而任意句子一律 500 `returned null audio`，
 * 13 个字符的 "She trembled." 也一样。所以例句音频必须继续走 MiniMax。
 *
 * 非官方端点：没有 SLA，可能限流或改接口。拉不到就抛错，绝不静默改用付费合成。
 * 自用可以，不要把抓下来的音频公开分发。
 */
export const YOUDAO_ENDPOINT = "https://dict.youdao.com/dictvoice";
export const YOUDAO_ACCENTS = { uk: 2, us: 1 };
export const YOUDAO_MODEL = "youdao-dictvoice";

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
  return { audioBase64: body.toString("base64"), bytes: body.length };
}
