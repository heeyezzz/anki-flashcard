/**
 * anki-flashcard — sentence difficulty check.
 *
 * Rule: everything in an example sentence except the target word must stay inside CEFR A2, so the
 * learner can read the card without meeting a second unknown word. This module turns the bundled
 * CEFR list into an allowed set and reports the tokens that fall outside it.
 *
 * The list ships headwords, so inflections are expanded here with the same rules the card templates
 * use to find the target word (-s / -es / -ed / -d / -ing / -ies / -ied / -ying / doubled final
 * consonant, plus 's). Being generous with inflections is correct: an inflected form of an A2 word
 * is still A2.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LIST = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/cefr-j-words.tsv");
const EXTRA_LIST = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/allow-extra.txt");
const IRREGULAR_LIST = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/irregular-forms.txt");
const ALLOWED_BANDS = new Set(["A1", "A2"]);
const NUMBER = /^[\d.,%$€£¥-]+$/;

const expandForms = (word) => {
  const forms = new Set([word]);
  const low = word.toLowerCase();
  if (/y$/.test(low)) {
    const stem = word.slice(0, -1);
    forms.add(stem + "ies");
    forms.add(stem + "ied");
    forms.add(stem + "ying");
  }
  if (/e$/.test(low)) {
    forms.add(word + "d");
    forms.add(word.slice(0, -1) + "ing");
    forms.add(word.slice(0, -1) + "er"); // larger / later: 比较级要吃掉词尾的 e
    forms.add(word.slice(0, -1) + "est");
  }
  if (/[^aeiouy]$/i.test(low)) {
    forms.add(word + word.slice(-1) + "ed");
    forms.add(word + word.slice(-1) + "ing");
  }
  for (const suffix of ["s", "es", "ed", "ing", "er", "est"]) forms.add(word + suffix);
  forms.add(word + "'s");
  return forms;
};

const readWordLines = async (path) => {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith("#"));
  } catch (_) {
    return []; // 缺少文件时该机制整体关闭，不影响其它校验。
  }
};

/** Load the CEFR list plus the user's own allow list. Returns { levels: Map<form, band>, allowed: Set<form> }. */
export const loadCefrList = async (path = DEFAULT_LIST) => {
  const source = await readFile(path, "utf8");
  const levels = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [word, level] = line.trim().split("\t");
    if (!word || !level) continue;
    for (const form of expandForms(word.toLowerCase())) {
      const existing = levels.get(form);
      if (!existing || (ALLOWED_BANDS.has(level) && !ALLOWED_BANDS.has(existing))) levels.set(form, level);
    }
  }
  const allowed = new Set([...levels].filter(([, level]) => ALLOWED_BANDS.has(level)).map(([form]) => form));
  // 不规则变化（made / meant / found…）：一律视为 A2 以内，避免明显误报。
  for (const form of await readWordLines(IRREGULAR_LIST)) {
    levels.set(form, "A1/A2");
    allowed.add(form);
  }
  // 自备白名单：用户已经掌握的专业词（如 contract / penalty）写进 assets/allow-extra.txt，
  // 它们就不再触发 A2 警告。空文件即最严格的 A2 规则。
  for (const word of await readWordLines(EXTRA_LIST)) {
    for (const form of expandForms(word)) {
      levels.set(form, `allow:${word}`);
      allowed.add(form);
    }
  }
  return { levels, allowed };
};

/**
 * Tokens in `sentence` that sit above A2, ignoring the target word's own forms.
 * Returns [{ token, level }] with `level` = the CEFR band or "未收录" when the list lacks the word.
 */
export const findAboveLevel = (sentence, { targetForms, levels, allowed }) => {
  const seen = new Map();
  const tokens = String(sentence || "").match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  const isFine = (token) => allowed.has(token) || targetForms?.has(token);
  for (const raw of tokens) {
    const token = raw.toLowerCase().replace(/[’]/g, "'");
    if (NUMBER.test(token)) continue;
    // 连字符复合词（early-career、value-added）按各部分分别判断：都合格就不算超纲。
    const parts = token.split("-").filter(Boolean);
    if (parts.length > 1 && parts.every(isFine)) continue;
    if (isFine(token)) continue;
    if (!seen.has(token)) seen.set(token, levels.get(token) || "未收录");
  }
  return [...seen].map(([token, level]) => ({ token, level }));
};

/** Same inflection set the templates use, reused here so the target word never counts as "hard". */
export const targetFormsOf = (word) => {
  const target = String(word || "").trim().toLowerCase();
  const forms = expandForms(target);
  // 多词目标（comply with）的词头本身也要豁免，否则句中的 "comply" 会被当成超纲词。
  for (const part of target.split(/\s+/)) if (part) for (const form of expandForms(part)) forms.add(form);
  return forms;
};
