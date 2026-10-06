#!/usr/bin/env node
/**
 * anki-flashcard — import complete 微语境闪卡 1.0 notes into Anki through AnkiConnect.
 *
 * Contract with the note type (see references/note-schema.md):
 *   Word, IPA, ChineseCore                      — required, one per note
 *   Sentence{i}, Meaning{i}, SentenceCN{i}, Analysis{i}  — three to five consecutive groups
 *   Theme, OtherMeanings, Source                — optional
 *   WordAudio, AudioSentence1..5                — written only by this script, never by input JSON
 *
 * Deliberately NOT used, unlike the AI多场景完型 importer:
 *   - no {{c1::...}} cloze markup: the 微语境闪卡 templates render the sentence as plain text and
 *     highlight the target word with mctxPattern(); cloze markup would show up verbatim.
 *   - no AudioWordAuto / [sound:...] tags: the back template already plays word -> sentence in
 *     sequence with its own JS player, so a native Anki autoplay tag would play the word twice.
 */
import { readFile } from "node:fs/promises";
import { cleanSpeechText, createMediaFilename, MINIMAX_TTS_ENDPOINT, synthesizeMiniMax } from "./minimax-tts.mjs";
import { getMiniMaxApiKey } from "./minimax-credentials.mjs";
import { loadCefrList } from "./level-check.mjs";
import { loadLexicon, senseHint } from "./lexicon.mjs";
import {
  ALL_NOTE_FIELDS, ALLOWED_THEMES, AUDIO_FIELDS, BASE_REQUIRED_FIELDS, CONTEXT_FIELDS, OPTIONAL_TEXT_FIELDS,
  THEME_FIELD, assert, getContextCount, isFilledString, normalizeTheme, normalizeWord, validateNote
} from "./note-rules.mjs";
export { contextWordPattern } from "./note-rules.mjs";

const DEFAULT_API_URL = "http://127.0.0.1:8766";
const DEFAULT_MODEL_NAME = process.env.ANKI_FLASHCARD_MODEL || "微语境闪卡 1.0";
const DEFAULT_TAG = "微语境";

const usage = "Usage: node import-vocabulary.mjs /absolute/path/to/notes.json [--dry-run] [--confirmed] [--without-tts] [--strict-level] [--no-level-check] [--anki-connect-url URL] [--tts minimax --minimax-voice VOICE_ID] [--minimax-model MODEL] [--minimax-speed NUMBER] [--minimax-min-interval-ms NUMBER] [--minimax-api-key-env NAME] [--minimax-keychain-service NAME] [--minimax-env-file PATH] [--minimax-endpoint URL] [--media-prefix PREFIX]";
const [inputPath, ...options] = process.argv.slice(2);
let dryRun = false;
let confirmed = false;
let strictLevel = false;
let levelCheck = true;
let configuredApiUrl = process.env.ANKI_CONNECT_URL || DEFAULT_API_URL;
const tts = {
  enabled: true,
  provider: "minimax",
  voiceId: "English_Steady_Female_1",
  model: "speech-2.8-hd",
  speed: 1,
  minIntervalMs: 11000,
  apiKeyEnv: "MINIMAX_API_KEY",
  keychainService: "anki-minimax-tts",
  envFile: "",
  endpoint: MINIMAX_TTS_ENDPOINT,
  mediaPrefix: "minimax"
};

if (!inputPath || inputPath.startsWith("--")) throw new Error(usage);
for (let index = 0; index < options.length; index += 1) {
  const option = options[index];
  const nextValue = (label) => {
    const value = options[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${usage}\n${label} requires a value.`);
    index += 1;
    return value;
  };
  if (option === "--dry-run") {
    dryRun = true;
  } else if (option === "--confirmed") {
    confirmed = true;
  } else if (option === "--without-tts") {
    tts.enabled = false;
  } else if (option === "--strict-level") {
    strictLevel = true;
  } else if (option === "--no-level-check") {
    levelCheck = false;
  } else if (option === "--anki-connect-url") {
    configuredApiUrl = nextValue("--anki-connect-url");
  } else if (option === "--tts") {
    const value = nextValue("--tts");
    if (value !== "minimax") throw new Error(`${usage}\n--tts currently supports only minimax.`);
    tts.provider = value;
    tts.enabled = true;
  } else if (option === "--minimax-voice") {
    tts.voiceId = nextValue("--minimax-voice");
  } else if (option === "--minimax-model") {
    tts.model = nextValue("--minimax-model");
  } else if (option === "--minimax-speed") {
    const value = Number(nextValue("--minimax-speed"));
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${usage}\n--minimax-speed requires a positive number.`);
    tts.speed = value;
  } else if (option === "--minimax-min-interval-ms") {
    const value = Number(nextValue("--minimax-min-interval-ms"));
    if (!Number.isFinite(value) || value < 0) throw new Error(`${usage}\n--minimax-min-interval-ms requires a non-negative number.`);
    tts.minIntervalMs = value;
  } else if (option === "--minimax-api-key-env") {
    tts.apiKeyEnv = nextValue("--minimax-api-key-env");
  } else if (option === "--minimax-keychain-service") {
    tts.keychainService = nextValue("--minimax-keychain-service");
  } else if (option === "--minimax-env-file") {
    tts.envFile = nextValue("--minimax-env-file");
  } else if (option === "--minimax-endpoint") {
    tts.endpoint = nextValue("--minimax-endpoint");
  } else if (option === "--media-prefix") {
    const value = nextValue("--media-prefix");
    if (!/^[a-z0-9-]+$/.test(value)) throw new Error(`${usage}\n--media-prefix accepts lowercase letters, digits, and hyphens.`);
    tts.mediaPrefix = value;
  } else {
    throw new Error(usage);
  }
}

if (tts.enabled) {
  assert(tts.voiceId, "MiniMax TTS requires --minimax-voice VOICE_ID.");
}

let apiUrl;
try {
  apiUrl = new URL(configuredApiUrl).toString().replace(/\/$/, "");
} catch (_) {
  throw new Error(`Invalid AnkiConnect URL: ${configuredApiUrl}`);
}

const invoke = async (action, params = {}) => {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params })
  });
  if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`AnkiConnect ${action}: ${payload.error}`);
  return payload.result;
};

// normalizeWord comes from note-rules.mjs so the importer and the rewriter compare words identically.

const raw = await readFile(inputPath, "utf8");
let input;
try {
  input = JSON.parse(raw);
} catch (_) {
  throw new Error("Input must be valid JSON.");
}

assert(input && typeof input === "object" && !Array.isArray(input), "Input must be a JSON object.");
const modelName = input.modelName ?? DEFAULT_MODEL_NAME;
assert(typeof modelName === "string" && modelName.trim(), "modelName must be a non-empty string when provided.");
assert(typeof input.deckName === "string" && input.deckName.trim(), "deckName must be a non-empty string.");
assert(Array.isArray(input.notes) && input.notes.length, "notes must be a non-empty array.");
assert(input.tags === undefined || (Array.isArray(input.tags) && input.tags.every((tag) => typeof tag === "string" && tag.trim())), "tags must be an array of non-empty strings when provided.");
const tags = input.tags?.length ? input.tags.map((tag) => tag.trim()) : [DEFAULT_TAG];

const warnings = [];
const levelFailures = [];
// 例句难度门：除目标词以外必须落在 CEFR A2 以内（见 references/example-design.md）
const cefr = levelCheck ? await loadCefrList() : { levels: new Map(), allowed: new Set() };
const lexicon = await loadLexicon();
const noteWords = new Set();
const contextCounts = input.notes.map((note, noteIndex) =>
  validateNote(note, noteIndex, { warnings, levelFailures, levelCheck, strictLevel, cefr, seenWords: noteWords, lexicon })
);

const [models, decks] = await Promise.all([invoke("modelNames"), invoke("deckNames")]);
assert(!levelFailures.length, `${levelFailures.join("；")}\n例句里除目标词以外的词必须保持在 CEFR A2 以内（确需收录更难的句子时用 --no-level-check 关闭该校验）。`);
assert(models.includes(modelName), `Missing Anki model: ${modelName}`);
assert(decks.includes(input.deckName), `Deck does not exist: ${input.deckName}`);
const modelFields = await invoke("modelFieldNames", { modelName });
const missingFields = ALL_NOTE_FIELDS.filter((field) => !modelFields.includes(field));
assert(!missingFields.length, `Model is missing fields: ${missingFields.join("、")}`);
if (tts.enabled) {
  const missingAudioFields = AUDIO_FIELDS.filter((field) => !modelFields.includes(field));
  assert(!missingAudioFields.length, `Model is missing TTS fields: ${missingAudioFields.join("、")}。请先运行 scripts/ensure-audio-fields.mjs 检查并在获得授权后用 --apply 修复。`);
}

const existingIds = await invoke("findNotes", { query: `note:\"${modelName.replace(/[\\\"]/g, "\\$&")}\"` });
const existingNotes = existingIds.length ? await invoke("notesInfo", { notes: existingIds }) : [];
const existingWords = new Set(existingNotes.map((note) => normalizeWord(note.fields.Word.value)));
const duplicates = input.notes.map((note) => note.Word.trim()).filter((word) => existingWords.has(normalizeWord(word)));
assert(!duplicates.length, `Words already exist in ${modelName}: ${duplicates.join("、")}`);

const ankiNotes = input.notes.map((fields) => ({
  deckName: input.deckName,
  modelName,
  fields: Object.fromEntries(ALL_NOTE_FIELDS.map((field) => [
    field,
    field === THEME_FIELD ? normalizeTheme(fields[field]) : (typeof fields[field] === "string" ? fields[field].trim() : "")
  ])),
  tags
}));
const canAdd = await invoke("canAddNotes", { notes: ankiNotes });
assert(canAdd.every(Boolean), "AnkiConnect rejected one or more notes during canAddNotes.");

// Planned audio: one word file plus one file per populated context.
const audioPlan = input.notes.map((note, noteIndex) => {
  const targets = [
    { field: "WordAudio", slot: "word", text: cleanSpeechText(note.Word) },
    ...Array.from({ length: contextCounts[noteIndex] }, (_, index) => ({
      field: `AudioSentence${index + 1}`,
      slot: `sentence-${index + 1}`,
      text: cleanSpeechText(note[`Sentence${index + 1}`])
    }))
  ];
  return targets.map((target) => ({
    ...target,
    filename: createMediaFilename({
      word: note.Word.trim(),
      slot: target.slot,
      text: target.text,
      model: tts.model,
      voiceId: tts.voiceId,
      speed: tts.speed,
      prefix: tts.mediaPrefix
    })
  }));
});

if (dryRun) {
  const cached = [];
  if (tts.enabled) {
    for (const targets of audioPlan) {
      for (const target of targets) {
        cached.push(await invoke("retrieveMediaFile", { filename: target.filename }) ? "reused" : "new");
      }
    }
  }
  console.log(JSON.stringify({
    dryRun: true,
    ankiConnectUrl: apiUrl,
    modelName,
    deckName: input.deckName,
    tags,
    lexicon: { present: lexicon.present, entries: lexicon.entries.size },
    preview: input.notes.map((note, index) => ({
      word: note.Word.trim(),
      ipa: note.IPA.trim(),
      chineseCore: note.ChineseCore.trim(),
      otherMeanings: (note.OtherMeanings || "").trim() || null,
      theme: ankiNotes[index].fields.Theme,
      // ECDICT 的中文释义按常用度排列：写语境时先覆盖排在前面的意思（生僻义只在其余几组里补充）。
      dictionary: senseHint(lexicon, note),
      contexts: contextCounts[index],
      examples: Array.from({ length: contextCounts[index] }, (_, contextIndex) => {
        const slot = contextIndex + 1;
        return {
          sentence: note[`Sentence${slot}`].trim(),
          meaning: note[`Meaning${slot}`].trim(),
          sentenceCN: note[`SentenceCN${slot}`].trim(),
          analysis: note[`Analysis${slot}`].trim()
        };
      })
    })),
    tts: tts.enabled ? {
      provider: tts.provider,
      model: tts.model,
      voiceId: tts.voiceId,
      speed: tts.speed,
      mediaPrefix: tts.mediaPrefix,
      audioFiles: audioPlan.map((targets) => targets.map((target) => ({ field: target.field, filename: target.filename }))),
      reused: cached.filter((state) => state === "reused").length,
      toGenerate: cached.filter((state) => state === "new").length
    } : null,
    warnings
  }, null, 2));
  process.exit(0);
}

assert(confirmed, "Refusing unconfirmed import. Run --dry-run, obtain the user's explicit approval of the word and every context, then rerun with --confirmed.");

if (warnings.length) console.log(JSON.stringify({ warnings }, null, 2));

if (tts.enabled && tts.provider === "minimax") {
  const apiKey = await getMiniMaxApiKey(tts);
  let generatedCharacters = 0;
  let reused = 0;
  for (const [noteIndex, targets] of audioPlan.entries()) {
    for (const field of AUDIO_FIELDS) ankiNotes[noteIndex].fields[field] = "";
    for (const target of targets) {
      if (await invoke("retrieveMediaFile", { filename: target.filename })) {
        reused += 1;
      } else {
        const generated = await synthesizeMiniMax({
          apiKey,
          endpoint: tts.endpoint,
          text: target.text,
          model: tts.model,
          voiceId: tts.voiceId,
          speed: tts.speed,
          minIntervalMs: tts.minIntervalMs
        });
        await invoke("storeMediaFile", { filename: target.filename, data: generated.audioBase64 });
        generatedCharacters += generated.usageCharacters;
      }
      ankiNotes[noteIndex].fields[target.field] = target.filename;
    }
  }
  console.log(`MiniMax TTS：复用 ${reused} 段音频，本次新生成 ${generatedCharacters} 个字符。`);
}

const noteIds = await invoke("addNotes", { notes: ankiNotes });
assert(noteIds.every(Boolean), "AnkiConnect returned an incomplete addNotes result; no automatic rollback was attempted.");
const readback = await invoke("notesInfo", { notes: noteIds });
for (const [index, note] of readback.entries()) {
  for (const field of [...ALL_NOTE_FIELDS, ...(tts.enabled ? AUDIO_FIELDS : [])]) {
    assert(note.fields[field]?.value === ankiNotes[index].fields[field], `Readback mismatch for ${ankiNotes[index].fields.Word}.${field}`);
  }
  assert(note.cards.length === 1, `Expected exactly one card for ${ankiNotes[index].fields.Word}, received ${note.cards.length}.`);
}

console.log(JSON.stringify({
  ankiConnectUrl: apiUrl,
  modelName,
  deckName: input.deckName,
  imported: readback.map((note) => ({ noteId: note.noteId, word: note.fields.Word.value, cardId: note.cards[0] }))
}, null, 2));
