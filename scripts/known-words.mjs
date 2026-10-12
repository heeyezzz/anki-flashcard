/**
 * anki-flashcard — the learner's own wordbook (TapDict personal list).
 *
 * Why this exists: the A2 gate's actual purpose is "reviewing this card should not hit a second word
 * you don't know". CEFR bands are only a proxy for that when nothing better is known. A word the
 * learner has marked as known in their own dictionary app is direct evidence, so it is exempt —
 * that makes the gate sharper, not weaker.
 *
 * Source of truth: `wordbook-latest.json` produced by 查词插件/tools/pull-wordbook.mjs, which pulls the
 * private gist the phone writes with 「词库 → 推送到云」. `refreshKnownWords()` runs that pull once at session
 * start so the gate never judges against a stale snapshot; `loadKnownWords()` only reads the local file.
 * Both are failure-proof: no pull script, no gist, or unreadable file → fall back to the local snapshot,
 * and no snapshot at all → no exemptions, everything else keeps working.
 */
import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_WORDBOOK = join(homedir(), "Documents/Project/查词插件/wordbook-latest.json");
export const DEFAULT_PULL = join(homedir(), "Documents/Project/查词插件/tools/pull-wordbook.mjs");
const run = promisify(execFile);
export const STALE_AFTER_DAYS = 7;

/** @returns {{words:Set<string>, count:number, path:string, missing:boolean, exportedAt:string|null, staleDays:number|null}} */
export const loadKnownWords = async (path = process.env.WORDBOOK_JSON || DEFAULT_WORDBOOK, { now = Date.now() } = {}) => {
  const empty = { words: new Set(), count: 0, path, missing: true, exportedAt: null, staleDays: null };
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (_) {
    return empty; // 没有词库就退回纯 CEFR 规则，不影响其它校验。
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return { ...empty, exportedAt: null };
  }
  const words = new Set((Array.isArray(parsed?.known) ? parsed.known : [])
    .map((entry) => String(entry?.w || "").trim().toLowerCase())
    .filter((word) => word && !word.includes(" ")));
  const exportedAt = parsed?.exportedAt || null;
  let staleDays = null;
  if (exportedAt) {
    staleDays = Math.floor((now - Date.parse(exportedAt)) / 86_400_000);
  } else {
    try {
      staleDays = Math.floor((now - (await stat(path)).mtimeMs) / 86_400_000);
    } catch (_) { /* 拿不到时间就不判断新鲜度 */ }
  }
  return { words, count: words.size, path, missing: false, exportedAt, staleDays };
};

/** 一句话给使用者看的状态，直接进 --dry-run 输出。 */
export const knownWordsNotice = (known) => (known.missing
  ? `个人词库不可用（${known.path}）：本次按纯 CEFR A2 规则判定`
  : `个人词库 ${known.count} 词已豁免${known.staleDays > STALE_AFTER_DAYS
      ? `；注意导出已是 ${known.staleDays} 天前，手机上记得点「推送到云」` : ""}`);

/**
 * 开跑前把词库刷成 gist 上的最新版：复用 查词插件 的 pull 脚本（gist id 与文件名约定只在那一处），
 * 显式传 --out 所以与调用方 cwd 无关。只读远端、只写本地快照。
 * 任何失败都不抛：拉不到就用本地缓存继续，把原因带回给调用方打印。
 */
export const refreshKnownWords = async ({ pullScript = process.env.WORDBOOK_PULL_CMD || DEFAULT_PULL,
  out = DEFAULT_WORDBOOK, timeoutMs = 30_000 } = {}) => {
  try {
    await access(pullScript);
  } catch (_) {
    return { ok: false, note: `没找到 ${pullScript}，本次沿用本地词库快照` };
  }
  try {
    await run(process.execPath, [pullScript, `--out=${out}`], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, note: "词库已从 gist 刷新" };
  } catch (error) {
    const reason = String(error?.stderr || error?.message || "").trim().split("\n").pop().slice(0, 120);
    return { ok: false, note: `词库拉取失败（${reason}），本次沿用本地缓存；手机上记得点「词库 → 推送到云」` };
  }
};
