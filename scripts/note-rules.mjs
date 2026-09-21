/**
 * anki-flashcard — the 微语境闪卡 1.0 content rules, shared by the importer and the rewriter.
 *
 * validateNote() is the single place that decides whether a generated card is acceptable:
 * required fields, 3–5 consecutive context groups, plain text (no cloze/HTML/sound tags), the target
 * word present in the CEFR form the template can highlight, Chinese where Chinese is required, and
 * every other word inside CEFR A2.
 */
import { findAboveLevel, targetFormsOf } from "./level-check.mjs";

export const THEME_FIELD = "Theme";
export const ALLOWED_THEMES = new Set(["minimal", "bauhaus"]);
export const BASE_REQUIRED_FIELDS = ["Word", "IPA", "ChineseCore"];
export const OPTIONAL_TEXT_FIELDS = ["OtherMeanings", "Source"];
export const CONTEXT_FIELDS = (index) => [
  `Sentence${index}`, `Meaning${index}`, `SentenceCN${index}`, `Analysis${index}`
];
export const ALL_NOTE_FIELDS = [
  ...BASE_REQUIRED_FIELDS,
  THEME_FIELD,
  ...OPTIONAL_TEXT_FIELDS,
  ...Array.from({ length: 5 }, (_, index) => CONTEXT_FIELDS(index + 1)).flat()
];
// WordAudio replaces AudioWord; this note type never uses AudioWordAuto or AudioMediaRefs.
export const AUDIO_FIELDS = ["WordAudio", ...Array.from({ length: 5 }, (_, index) => `AudioSentence${index + 1}`)];
export const FULL_POS_WORD = /^(nouns?|verbs?|adjectives?|adverbs?|prepositions?|pronouns?|conjunctions?|determiners?|articles?|phrases?)\b/i;
export const MARKUP = /\{\{|\}\}|\[sound:|<\/?[a-z][^>]*>/i;
export const CJK = /[\u3400-\u9fff]/;
export const MAX_SENTENCE_CHARS = 160;
export const MIN_SENTENCE_WORDS = 5;

export const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const isFilledString = (value) => typeof value === "string" && value.trim();
export const normalizeTheme = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return "bauhaus";
  return String(value).trim().toLocaleLowerCase("en-US");
};
export const normalizeWord = (value) => String(value).normalize("NFKC").trim().toLocaleLowerCase("en-US");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Mirrors mctxPattern() in the 微语境闪卡 front/back templates. The templates derive inflections at
 * render time to highlight the target word, so the rules must accept exactly the forms the template
 * can find — and reject a sentence the template would render without any highlight.
 */
export const contextWordPattern = (word) => {
  const w = String(word == null ? "" : word).trim();
  if (!w) return null;
  if (/\s/.test(w)) {
    return new RegExp("\\b" + w.split(/\s+/).map(escapeRegExp).join("[\\s\\-]+") + "\\b", "gi");
  }
  const low = w.toLowerCase();
  const forms = new Set([w]);
  if (/y$/.test(low)) {
    const stem = w.slice(0, -1);
    forms.add(stem + "ies");
    forms.add(stem + "ied");
    forms.add(stem + "ying");
  }
  if (/e$/.test(low)) {
    forms.add(w + "d");
    forms.add(w.slice(0, -1) + "ing");
  }
  if (/[^aeiouy]$/i.test(low)) {
    forms.add(w + w.slice(-1) + "ed");
    forms.add(w + w.slice(-1) + "ing");
  }
  forms.add(w + "s");
  forms.add(w + "es");
  forms.add(w + "ed");
  forms.add(w + "ing");
  const alts = [...forms].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp("\\b(?:" + alts.join("|") + ")\\b", "gi");
};
export const sentenceCarriesTarget = (sentence, word) => {
  const pattern = contextWordPattern(word);
  return pattern ? pattern.test(sentence) : false;
};

export const getContextCount = (note, noteIndex) => {
  let count = 0;
  let foundGap = false;
  for (let index = 1; index <= 5; index += 1) {
    const fields = CONTEXT_FIELDS(index);
    const populated = fields.map((field) => isFilledString(note[field]));
    const hasAny = fields.some((field) => isFilledString(note[field]));
    if (!hasAny) {
      foundGap = true;
      continue;
    }
    assert(populated.every(Boolean), `notes[${noteIndex}] context ${index} must provide Sentence, Meaning, SentenceCN, and Analysis together.`);
    assert(!foundGap, `notes[${noteIndex}] contexts must be consecutive; context ${index} cannot follow an empty context.`);
    count = index;
  }
  assert(count >= 3, `notes[${noteIndex}] must provide three to five complete contexts.`);
  return count;
};

/**
 * Validate one note and return its context count.
 * ctx = { warnings, levelFailures, levelCheck, strictLevel, cefr, seenWords }
 *   warnings/levelFailures are appended to; seenWords holds already-used words (duplicate detection);
 *   cefr is the loaded CEFR list, or null to skip the A2 gate; strictLevel promotes A2 findings from
 *   levelFailures (which the caller turns into a hard error) instead of warnings.
 */
export const validateNote = (note, noteIndex, ctx) => {
  const { warnings, levelFailures, levelCheck, strictLevel, cefr, seenWords } = ctx;
  assert(note && typeof note === "object" && !Array.isArray(note), `notes[${noteIndex}] must be an object.`);
  for (const field of BASE_REQUIRED_FIELDS) {
    assert(isFilledString(note[field]), `notes[${noteIndex}].${field} must be a non-empty string.`);
  }
  for (const field of OPTIONAL_TEXT_FIELDS) {
    assert(note[field] === undefined || note[field] === null || typeof note[field] === "string", `notes[${noteIndex}].${field} must be a string when provided.`);
  }
  assert(ALLOWED_THEMES.has(normalizeTheme(note.Theme)), `notes[${noteIndex}].Theme must be one of: ${[...ALLOWED_THEMES].join("、")}。`);

  const word = note.Word.trim();
  assert(!CJK.test(word), `notes[${noteIndex}].Word must be English; Chinese belongs in ChineseCore.`);
  assert(/^[A-Za-z][A-Za-z\s'\-.]*$/.test(word), `notes[${noteIndex}].Word must be a plain English word or phrase.`);
  assert(!seenWords.has(normalizeWord(word)), `Duplicate Word in input: ${word}`);
  seenWords.add(normalizeWord(word));

  assert(!FULL_POS_WORD.test(note.ChineseCore.trim()), `notes[${noteIndex}].ChineseCore must open with an abbreviation such as n. / v. / adj., not a full English word.`);
  assert(CJK.test(note.ChineseCore), `notes[${noteIndex}].ChineseCore must contain Chinese.`);
  if (!/^\//.test(note.IPA.trim())) warnings.push(`notes[${noteIndex}].IPA does not start with "/": ${note.IPA.trim()}`);

  const contextCount = getContextCount(note, noteIndex);
  for (let index = 1; index <= contextCount; index += 1) {
    const sentence = note[`Sentence${index}`].trim();
    assert(!MARKUP.test(sentence), `notes[${noteIndex}].Sentence${index} must be plain text: no cloze markup, HTML, or sound tags.`);
    assert(sentenceCarriesTarget(sentence, word), `notes[${noteIndex}].Sentence${index} must contain "${word}" or one of its inflections; the 微语境闪卡 template highlights the target word by matching it in the sentence.`);
    if (sentence.length > MAX_SENTENCE_CHARS) warnings.push(`notes[${noteIndex}].Sentence${index} is ${sentence.length} characters; the card renders at ~30 characters per line on wide screens.`);
    if (sentence.split(/\s+/).length < MIN_SENTENCE_WORDS) warnings.push(`notes[${noteIndex}].Sentence${index} has fewer than ${MIN_SENTENCE_WORDS} words; the context may be too thin to retrieve from.`);
    if (levelCheck && cefr) {
      const above = findAboveLevel(sentence, {
        targetForms: targetFormsOf(word), levels: cefr.levels, allowed: cefr.allowed
      });
      if (above.length) {
        const detail = above.map(({ token, level }) => `${token} (${level})`).join("、");
        (strictLevel ? levelFailures : warnings).push(`notes[${noteIndex}].Sentence${index} 除目标词外超出 A2 的词：${detail}`);
      }
    }
    assert(CJK.test(note[`Meaning${index}`]), `notes[${noteIndex}].Meaning${index} must contain Chinese (本句语境义).`);
    assert(CJK.test(note[`SentenceCN${index}`]), `notes[${noteIndex}].SentenceCN${index} must contain Chinese (整句中文翻译).`);
    if (!CJK.test(note[`Analysis${index}`])) warnings.push(`notes[${noteIndex}].Analysis${index} has no Chinese; 搭配解析 is normally written in Chinese.`);
  }
  return contextCount;
};
