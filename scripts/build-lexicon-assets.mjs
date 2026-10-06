#!/usr/bin/env node
/**
 * anki-flashcard — rebuild the offline lexicon assets from ECDICT (skywind3000/ECDICT, 63 MB CSV).
 *
 *   node scripts/build-lexicon-assets.mjs [--ecdict PATH] [--words PATH]
 *
 * Writes two assets:
 *   assets/ecdict-mini.tsv       word → phonetic / 中文释义（按常用度排）/ exchange，供 scripts/lexicon.mjs 对账
 *   assets/irregular-forms.txt   不规则变化表，从 ECDICT 的 exchange 生成，替代手抄清单
 *
 * The irregular table only takes forms whose lemma is itself inside A1/A2 (plus the user's
 * assets/allow-extra.txt): exempting `misled` would hand a B2+ word a free pass through the A2 gate.
 * Entries already in the file are kept, so hand-added forms survive a rebuild.
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const DEFAULT_SOURCE = join(process.env.HOME || "", ".vocab-test/.cache/ecdict.csv");
// A card target is usually a B2+ word the learner met at work, so rank alone is not coverage: pull in
// the whole CEFR list, the Oxford 3000 flag, and every 3+ star Collins word as well.
const FREQUENCY_RANK = 12_000;
const IRREGULAR_KINDS = new Set(["s", "d", "i", "p", "r", "t"]); // plural, past, ing, past participle, comparative, superlative

const usage = "Usage: node build-lexicon-assets.mjs [--ecdict PATH] [--words PATH]";
const options = process.argv.slice(2);
let source = process.env.ECDICT_CSV || DEFAULT_SOURCE;
let extraWordsPath = "";
for (let index = 0; index < options.length; index += 1) {
  const option = options[index];
  const nextValue = (label) => {
    const value = options[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${usage}\n${label} requires a value.`);
    index += 1;
    return value;
  };
  if (option === "--ecdict") source = nextValue("--ecdict");
  else if (option === "--words") extraWordsPath = nextValue("--words");
  else throw new Error(usage);
}

const readWordLines = async (path) => {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/)
      .map((line) => line.trim().toLowerCase()).filter((line) => line && !line.startsWith("#"));
  } catch (_) {
    return [];
  }
};

const parseCsvLine = (line) => {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { fields.push(current); current = ""; }
    else current += char;
  }
  fields.push(current);
  return fields;
};

// Forms a regular rule already produces, so they need no table entry.
const regularForms = (word) => {
    const low = word.toLowerCase();
    const forms = new Set([low + "s", low + "es", low + "ed", low + "d", low + "ing", low + "er", low + "est"]);
    if (/y$/.test(low)) forms.add(low.slice(0, -1) + "ies", low.slice(0, -1) + "ied", low.slice(0, -1) + "ying", low.slice(0, -1) + "ier", low.slice(0, -1) + "iest");
    if (/[^aeiouy]$/.test(low)) forms.add(low + low.slice(-1) + "ed", low + low.slice(-1) + "ing", low + low.slice(-1) + "er", low + low.slice(-1) + "est");
    return forms;
  };

const cefrLines = (await readFile(join(ASSETS, "cefr-j-words.tsv"), "utf8")).split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"));
const cefrWords = new Set();
const easyLemmas = new Set();
for (const line of cefrLines) {
  const [word, level] = line.trim().split("\t");
  if (!word || !level) continue;
  cefrWords.add(word.toLowerCase());
  if (level === "A1" || level === "A2") easyLemmas.add(word.toLowerCase());
}
const extraAllow = new Set(await readWordLines(join(ASSETS, "allow-extra.txt")));
const wanted = new Set([...cefrWords, ...extraAllow, ...(extraWordsPath ? await readWordLines(extraWordsPath) : [])]);
const exemptLemmas = new Set([...easyLemmas, ...extraAllow]);
const existingIrregulars = await readWordLines(join(ASSETS, "irregular-forms.txt"));

// Phrasal cards (comply with, packing list) carry no frequency rank, so the rank cut never keeps them.
// Pull the words already in the note type straight from Anki when it is reachable.
const cardedWords = async () => {
  const url = process.env.ANKI_CONNECT_URL || "http://127.0.0.1:8766";
  const model = process.env.ANKI_FLASHCARD_MODEL || "微语境闪卡 1.0";
  try {
    const post = async (action, params) => {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: 6, params }), signal: AbortSignal.timeout(8000)
      });
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);
      return payload.result;
    };
    const ids = await post("findNotes", { query: `note:"${model}"` });
    if (!ids.length) return [];
    const notes = await post("notesInfo", { notes: ids });
    return notes.map((note) => String(note.fields.Word?.value || "").trim().toLowerCase()).filter(Boolean);
  } catch (error) {
    console.error(`（Anki 不可达，跳过已有牌组词：${error.message}；需要时用 --words 手动传入）`);
    return [];
  }
};
for (const word of await cardedWords()) wanted.add(word);

const csv = await readFile(source, "utf8");
const lines = csv.split("\n");
const header = parseCsvLine(lines[0]).map((name) => name.trim());
const at = (name) => {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`${source} has no "${name}" column`);
  return index;
};
const column = { word: at("word"), phonetic: at("phonetic"), translation: at("translation"), exchange: at("exchange"), collins: at("collins"), oxford: at("oxford"), bnc: at("bnc"), frq: at("frq") };
// Number("") is 0, which would let every row without a rank pass the frequency cut.
const rank = (value) => {
  const text = String(value ?? "").trim();
  const n = Number(text);
  return text && Number.isFinite(n) && n > 0 ? n : Infinity;
};

const kept = [];
const generated = new Set();
let scanned = 0;
for (let index = 1; index < lines.length; index += 1) {
  if (!lines[index].trim()) continue;
  const fields = parseCsvLine(lines[index]);
  const word = String(fields[column.word] || "").trim().toLowerCase();
  if (!/^[a-z][a-z .'-]*$/.test(word)) continue;
  scanned += 1;
  const exchange = String(fields[column.exchange] || "").trim();
  if (exchange && exemptLemmas.has(word)) {
    const regular = regularForms(word);
    for (const entry of exchange.split("/")) {
      const separator = entry.indexOf(":");
      if (separator < 0) continue;
      const kind = entry.slice(0, separator);
      const form = entry.slice(separator + 1).trim();
      if (!IRREGULAR_KINDS.has(kind) || !form || regular.has(form) || form === word) continue;
      if (/^[a-z][a-z'’-]*$/.test(form)) generated.add(form);
    }
  }
  const collins = rank(fields[column.collins]);
  const covered = wanted.has(word) || fields[column.oxford]?.trim() === "1"
    || (collins !== Infinity && collins >= 3) || rank(fields[column.bnc]) <= FREQUENCY_RANK
    || rank(fields[column.frq]) <= FREQUENCY_RANK;
  if (!covered) continue;
  kept.push([
    word,
    String(fields[column.phonetic] || "").trim(),
    String(fields[column.translation] || "").replace(/\\n/g, "；").replace(/\s+/g, " ").slice(0, 160),
    exchange.slice(0, 140)
  ].join("\t"));
}

const irregular = new Set([...generated, ...existingIrregulars]);
const handOnly = existingIrregulars.filter((form) => !generated.has(form));

const sorted = [...irregular].sort();
await writeFile(join(ASSETS, "ecdict-mini.tsv"),
  `# anki-flashcard · ECDICT 精简表（释义对账用）\n# 重新生成：node scripts/build-lexicon-assets.mjs\n# 来源：skywind3000/ECDICT\n# word\tphonetic\ttranslation(中文释义，按常用度排列)\texchange(词形变化)\n${kept.join("\n")}\n`, "utf8");
await writeFile(join(ASSETS, "irregular-forms.txt"),
  `# anki-flashcard · 不规则变化（仅用于例句难度校验，减轻误报）
#
# 作用：CEFR 词表收录的是原形，而例句里常用不规则过去式/过去分词（made、found、meant…），
#       名词复数（children、mice）和比较级（better、worse）同理。这里列出它们，
#       level-check.mjs 就把它们算作 A2 以内，不当作超纲词。
#
# 用法：一行一个词形。不要往这里放普通词——每条都会让一个真实词形免于超纲检查。
#
# 重新生成：node scripts/build-lexicon-assets.mjs（取 ECDICT exchange 里原形属 A1/A2 的不规则形式）
# 共 ${sorted.length} 条，其中 ${generated.size} 条来自 ECDICT，${handOnly.length} 条沿用手工清单。
${sorted.join("\n")}
`, "utf8");
const size = async (name) => Math.round((await stat(join(ASSETS, name))).size / 1024);
console.log(JSON.stringify({
  source, scanned, kept: kept.length,
  irregularForms: sorted.length, generatedByEcdict: generated.size, keptFromHandList: handOnly.length,
  ecdictMiniKB: await size("ecdict-mini.tsv"), irregularFormsKB: await size("irregular-forms.txt")
}, null, 2));
