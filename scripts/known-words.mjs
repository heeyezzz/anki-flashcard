/**
 * anki-flashcard — the learner's own wordbook (TapDict personal list).
 *
 * Why this exists: the A2 gate's actual purpose is "reviewing this card should not hit a second word
 * you don't know". CEFR bands are only a proxy for that when nothing better is known. A word the
 * learner has marked as known in their own dictionary app is direct evidence, so it is exempt —
 * that makes the gate sharper, not weaker.
 *
 * Source of truth: `wordbook-latest.json` produced by 查词插件/tools/pull-wordbook.mjs, which pulls the
 * private gist the phone writes with 「词库 → 推送到云」. This module only reads the local file; it never
 * pulls and never writes. Missing or unreadable file → no exemptions, everything else keeps working.
 */
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_WORDBOOK = join(homedir(), "Documents/Project/查词插件/wordbook-latest.json");
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
