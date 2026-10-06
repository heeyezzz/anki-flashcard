/**
 * anki-flashcard — the 微语境闪卡 1.0 content rules, shared by the importer and the rewriter.
 *
 * validateNote() is the single place that decides whether a generated card is acceptable:
 * required fields, 3–5 consecutive context groups, plain text (no cloze/HTML/sound tags), the target
 * word present in the CEFR form the template can highlight, Chinese where Chinese is required, and
 * every other word inside CEFR A2.
 */
import { findAboveLevel, targetFormsOf } from "./level-check.mjs";
import { checkNote } from "./lexicon.mjs";

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
export const MARKUP = /\{\{|\}\}|\[sound:|【|】|<\/?[a-z][^>]*>/i;
// 背面译文下划线靠 SentenceCN 里恰好一处【…】标记（模板把【x】渲染成 <u>x</u>，悬停显示同组 Meaning）。
export const GLOSS_MARK = /【[^】]*】/g;
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

// Closed-class words carry no retrieval cue, so a sentence's "skeleton" is what is left after the
// target form and these are dropped. Two contexts sharing most of a skeleton are one condition
// paraphrased, which is the failure mode the 微语境 design cannot recover from at review time.
export const STOPWORDS = new Set(`a an the this that these those and or but if of in on at to for from
with about as by than then so not no is are was were be been being do does did have has had will would
can could may might must should you your yours i me my mine we our ours they their theirs it its he she
him her hers them there here every each some any both more most other such please next before after
when while what which who whom whose how why where`
  .split(/\s+/));

// Jaccard dilutes when one sentence carries an extra detail word, and containment fires on a single
// shared noun — so a paraphrase needs to overlap most of the thinner skeleton *and* carry substance.
export const SKELETON_SIMILAR_WARN = 0.75;
export const MIN_SHARED_CONTENT_WORDS = 3;

export const skeletonWords = (sentence, word) => {
  const pattern = contextWordPattern(word);
  const stripped = pattern ? String(sentence).replace(pattern, " ") : String(sentence);
  return new Set(stripped.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/[\s'-]+/)
    .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !STOPWORDS.has(token)));
};

const plainSentence = (sentence) => sentence.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

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
  const { warnings, levelFailures, levelCheck, strictLevel, cefr, seenWords, lexicon } = ctx;
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
  // ECDICT 对账（词性 / 音标）只出警告：聚合词典不是权威，但它能抓住"释义词性写错""音标抄错"。
  if (lexicon?.present) warnings.push(...checkNote(lexicon, { ...note, Word: word }));

  const contextCount = getContextCount(note, noteIndex);
  const contexts = [];
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
    const cn = note[`SentenceCN${index}`];
    const marks = cn.match(GLOSS_MARK) || [];
    const unbalanced = (cn.match(/【/g) || []).length !== (cn.match(/】/g) || []).length;
    if (unbalanced || marks.length !== 1 || marks[0] === "【】") {
      warnings.push(`notes[${noteIndex}].SentenceCN${index} 需要恰好一处【…】来标出目标词对应的译词（背面的下划线和悬停释义都靠它渲染）：${unbalanced ? "括号不成对" : `找到 ${marks.length} 处`}。`);
    }
    if (!CJK.test(note[`Analysis${index}`])) warnings.push(`notes[${noteIndex}].Analysis${index} has no Chinese; 搭配解析 is normally written in Chinese.`);
    contexts.push({
      index,
      sentence: plainSentence(sentence),
      meaning: note[`Meaning${index}`].trim().replace(/\s+/g, ""),
      skeleton: skeletonWords(sentence, word)
    });
  }
  for (let a = 0; a < contexts.length; a += 1) {
    for (let b = a + 1; b < contexts.length; b += 1) {
      const first = contexts[a];
      const second = contexts[b];
      const pair = `notes[${noteIndex}] 语境 ${first.index} 与 ${second.index}`;
      assert(first.meaning !== second.meaning, `${pair} 的 Meaning 完全相同：两张卡面答案一样就是同一个检索条件，请合并或换掉一个（见 references/example-design.md 第 5 条）。`);
      assert(first.sentence !== second.sentence, `${pair} 的 Sentence 完全相同。`);
      const shared = [...first.skeleton].filter((token) => second.skeleton.has(token));
      const thinner = Math.min(first.skeleton.size, second.skeleton.size);
      const containment = thinner ? shared.length / thinner : 0;
      if (shared.length >= MIN_SHARED_CONTENT_WORDS && containment >= SKELETON_SIMILAR_WARN) {
        warnings.push(`${pair} 的句子骨架 ${shared.length}/${thinner} 个实词相同（${shared.join(" ")}）：更像同一情境的改写而不是新的检索条件，建议换领域、换搭配或换句法功能。`);
      }
    }
  }
  return contextCount;
};
