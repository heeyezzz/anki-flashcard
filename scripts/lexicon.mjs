#!/usr/bin/env node
/**
 * anki-flashcard — the offline ECDICT lookup used to cross-check a card against a real dictionary.
 *
 * Three checks, all warnings: the part of speech `ChineseCore` opens with, the `IPA` string, and a
 * sense list (ECDICT's Chinese glosses, which are ordered by commonness) so the sentence work can
 * start from the word's main meaning. This is a cross-check, not a source of truth: ECDICT aggregates
 * several dictionaries, so a mismatch means "look again", never "the dictionary is right".
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LIST = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "ecdict-mini.tsv");
const DOMAIN_TAG = /(\[[^\]]*\]|【[^】]*】|\(.*?\))/g;
const POS_TOKEN = /(?:^|[\s；;，,])(n|nan|nt|u|c|vt|vi|v|a|adj|ad|adv|prep|pron|conj|det|art|aux|phr|int|interj|num|modal)\.\s/g;
// What each card-side abbreviation is satisfied by in ECDICT's tag vocabulary.
const POS_ALIASES = {
  n: ["n", "nan", "nt", "u", "c"], v: ["v", "vt", "vi"], adj: ["adj", "a"], adv: ["adv", "ad"],
  prep: ["prep"], pron: ["pron"], conj: ["conj"], det: ["det", "art"], aux: ["aux", "v", "modal"], phr: ["phr"]
};
// ECDICT writes DJ phonetics in a loose ASCII-ish alphabet; fold both sides onto comparable letters.
const IPA_FOLD = [
  ["eɪ", "ei"], ["aɪ", "ai"], ["ɔɪ", "oi"], ["aʊ", "au"], ["eə", "e"], ["ɪə", "i"], ["ʊə", "u"],
  // /əʊ/ in DJ and /oʊ/ in KK, plus ECDICT's ASCII-ish "әu"/"əu", all have to land on one token.
  ["əʊ", "o"], ["oʊ", "o"], ["әu", "o"], ["əu", "o"], ["oʊ", "o"],
  ["tʃ", "c"], ["dʒ", "j"], ["ː", ""], ["ˈ", ""], ["ˌ", ""], ["ɪ", "i"], ["i", "i"], ["ɛ", "e"], ["e", "e"], ["æ", "a"],
  ["ɑ", "a"], ["ʌ", "a"], ["ə", "e"], ["ө", "e"], ["ә", "e"], ["ɒ", "o"], ["ɔ", "o"], ["u", "u"], ["ʊ", "u"], ["ŋ", "n"], ["θ", "t"],
  ["ð", "d"], ["ʃ", "s"], ["ʒ", "z"], ["ç", "c"], ["ɹ", "r"], ["ɡ", "g"], ["χ", "k"], ["ˑ", ""], ["·", ""]
];

const editDistance = (a, b) => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
};

export const foldPhonetic = (value) => {
  let text = String(value || "").toLowerCase().replace(/[/[\](){}]/g, " ");
  for (const [from, to] of IPA_FOLD) text = text.split(from).join(to);
  return text.replace(/[^a-z]/g, "");
};

export const phoneticSimilarity = (card, dictionary) => {
  const a = foldPhonetic(card);
  const b = foldPhonetic(dictionary);
  // One edit on a two- or three-letter form swings the ratio wildly (go /ɡoʊ/ vs "gou"), so short
  // phonetics are not comparable — say nothing rather than cry wolf.
  if (!a || !b || Math.max(a.length, b.length) < 4) return null;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
};

const parseLine = (line) => {
  const [word, phonetic = "", translation = "", exchange = ""] = line.split("\t");
  const senses = translation.replace(DOMAIN_TAG, " ").replace(/\s+/g, " ").replace(/[；;]\s*[；;]/g, "；").trim();
  const tags = new Set();
  for (const match of translation.matchAll(POS_TOKEN)) tags.add(match[1]);
  // raw keeps the [计]/[经] tags — dictionaryCore needs them to drop subject-specific chunks.
  return { word, phonetic: phonetic.trim(), senses, raw: translation.trim(), tags, exchange: exchange.trim() };
};

/** Load the lookup table. A missing or empty asset turns every check into a no-op. */
export const loadLexicon = async (path = DEFAULT_LIST) => {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (_) {
    return { present: false, path, entries: new Map() };
  }
  const entries = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const entry = parseLine(line);
    if (entry.word && !entries.has(entry.word)) entries.set(entry.word, entry);
  }
  return { present: entries.size > 0, path, entries };
};

export const lookup = (lexicon, word) => lexicon?.entries?.get(String(word || "").trim().toLowerCase()) || null;

export const declaredPartsOfSpeech = (chineseCore) => {
  const head = String(chineseCore || "").split(/[\u3400-\u9fff]/)[0];
  return [...head.matchAll(/\b(n|v|adj|adv|prep|pron|conj|det|aux|phr)\./gi)].map((match) => match[1].toLowerCase());
};

/**
 * Cross-check one note against ECDICT. Returns warning strings; never throws and never blocks —
 * an aggregated dictionary is not authority over the learner's own card.
 */
export const checkNote = (lexicon, note) => {
  const warnings = [];
  if (!lexicon?.present) return warnings;
  const entry = lookup(lexicon, note.Word);
  const label = `notes[${note.Word}]`;
  if (!entry) return warnings;

  const declared = declaredPartsOfSpeech(note.ChineseCore);
  if (!declared.length) {
    warnings.push(`${label}.ChineseCore 没有以词性缩写开头（约定形如 v. 免除，放弃）。`);
  } else if (entry.tags.size && !declared.includes("phr")) {
    const unsupported = declared.filter((pos) => !(POS_ALIASES[pos] || []).some((tag) => entry.tags.has(tag)));
    if (unsupported.length) {
      warnings.push(`${label}.ChineseCore 词性 ${unsupported.join("/")} 与 ECDICT 对该词的标注不符（ECDICT: ${[...entry.tags].join("/")}）：${entry.senses}`);
    }
  }
  const similarity = phoneticSimilarity(note.IPA, entry.phonetic);
  if (similarity !== null && similarity < 0.7) {
    warnings.push(`${label}.IPA ${note.IPA} 与 ECDICT 音标 ${entry.phonetic} 相差较大（相似度 ${Math.round(similarity * 100)}%），请核对是否为同一读音。`);
  }
  return warnings;
};

/** The dictionary block shown in --dry-run: sense order for context design + the ChineseCore floor. */
export const senseHint = (lexicon, note) => {
  if (!lexicon?.present) return null;
  const entry = lookup(lexicon, note.Word);
  if (!entry) return { found: false };
  const dictionary = dictionaryCore(entry);
  return {
    found: true,
    phonetic: entry.phonetic || null,
    senses: entry.senses || null,
    pos: [...entry.tags],
    core: dictionary?.core || null,
    usable: dictionary?.usable ?? false,
    reason: dictionary?.reason || (dictionary ? null : "词典无可解析释义")
  };
};

/* ------------------------------------------------------------------ *
 * ChineseCore: dictionary first, AI finishes the wording.
 * ------------------------------------------------------------------ */

const POS_CANON = {
  n: "n.", nan: "n.", nt: "n.", u: "n.", c: "n.", v: "v.", vt: "v.", vi: "v.", aux: "v.", modal: "v.",
  a: "adj.", adj: "adj.", ad: "adv.", adv: "adv.", prep: "prep.", pron: "pron.", conj: "conj.",
  det: "det.", art: "det.", num: "num.", int: "int.", phr: "phr."
};

/**
 * 卡面允许出现在义项组开头的词性缩写（不带句点）。这是**唯一来源**：
 * 模板不能 import，所以 Back.html 里的 POS_HEAD 抄一份，由
 * tests/template-invariants.mjs 断言两边集合相等——曾经因为模板少抄了
 * phr / det，导致 `phr. in spite of 尽管` 被挂到上一组的 `n` 徽标下面。
 */
export const CARD_POS = [...new Set(Object.values(POS_CANON).map((tag) => tag.replace(/\.$/, "")))]
  .concat(["vt", "vi", "aux", "art", "abbr", "excl"])
  .sort();
const POS_HEAD = /^\s*([a-z]{1,6})\.\s*/;
// "(house-breaker 的复数)" — dictionary meta text, not a gloss. Chinese-only parens like 特殊(权) stay.
const META_PAREN = /\([^)]*[A-Za-z][^)]*\)|（[^）]*[A-Za-z][^）]*）/g;
export const MAX_SENSES_PER_POS = 4;
export const MAX_CORE_CHARS = 48;
// Dictionary artefacts that must never reach the card: truncated entries ("制...表") and cross refs.
const JUNK_GLOSS = /\.{2,}|…|=/;

const hanzi = (text) => (String(text).match(/[\u3400-\u9fff]/g) || []);

/**
 * Turn an ECDICT gloss string into the floor for `ChineseCore`: domain-tagged chunks dropped,
 * parts of speech canonicalised (a. → adj., vt/vi → v.), senses de-duplicated in dictionary order.
 * `usable` is false when the dictionary cannot carry the field — too few characters, or no part of
 * speech at all (typical for phrasal entries like "comply with" = 照做) — and the AI writes it instead.
 */
export const dictionaryCore = (entry) => {
  const raw = String(entry?.raw || entry?.senses || "").replace(META_PAREN, " ");
  if (!raw.trim()) return null;
  const groups = [];
  for (const chunk of raw.split(/[；;]/)) {
    // A chunk that opens with a domain tag is a subject-specific gloss ([计]/[经]/[法]/[医]…): out.
    if (/^\s*\[[^\]]*\]/.test(chunk)) continue;
    const head = chunk.match(POS_HEAD);
    const pos = head ? POS_CANON[head[1].toLowerCase()] || null : null;
    const parts = [];
    for (const piece of (head ? chunk.slice(head[0].length) : chunk).split(/[,，、\s]+/)) {
      const gloss = piece.replace(DOMAIN_TAG, "").trim();
      if (!gloss || !hanzi(gloss).length || JUNK_GLOSS.test(gloss)) continue;
      if (!parts.includes(gloss)) parts.push(gloss);
    }
    if (parts.length) {
      // vt./vi. both canonicalise to v. — merge them so the floor never reads "v. …；v. …".
      const existing = groups.find((group) => group.pos === pos);
      if (existing) existing.parts.push(...parts.filter((gloss) => !existing.parts.includes(gloss)));
      else groups.push({ pos, parts });
    }
  }
  if (!groups.length) return null;

  const seen = new Set();
  const blocks = [];
  let budget = MAX_CORE_CHARS;
  for (const group of groups) {
    const kept = [];
    for (const gloss of group.parts) {
      if (seen.has(gloss)) continue;
      if (kept.length >= MAX_SENSES_PER_POS || gloss.length > Math.max(2, budget - (group.pos ? group.pos.length + 1 : 0))) continue;
      kept.push(gloss);
      seen.add(gloss);
      budget -= gloss.length + 1;
    }
    if (!kept.length) continue;
    blocks.push(`${group.pos || ""} ${kept.join("，")}`.trim());
  }
  const core = blocks.join("；");
  const senses = groups.flatMap((group) => group.parts);
  const hasPos = groups.some((group) => group.pos);
  const chars = hanzi(core).length;
  return {
    core,
    senses,
    posGroups: groups.map((group) => ({ pos: group.pos, first: group.parts[0] })),
    usable: hasPos && chars >= 6,
    // Why the dictionary cannot carry the field on its own — the AI writes it and says so.
    reason: !hasPos ? "词典无词性标注（多为短语词条）" : chars < 6 ? `词典义项仅 ${chars} 个汉字，不足以独立成卡面释义` : null
  };
};

