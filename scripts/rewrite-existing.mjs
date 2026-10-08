#!/usr/bin/env node
/**
 * anki-flashcard — rewrite the content of existing 微语境闪卡 notes in place, audio included.
 *
 * This script never adds or deletes notes. It matches each input note to an existing note by Word
 * inside one deck (--deck), updates the content fields, regenerates only the audio whose text really
 * changed, and deletes the media files it replaced. Scheduling is untouched, so the learner keeps
 * their review history — that is the whole point of rewriting instead of delete + re-import.
 *
 * Rules are the same as the importer's: the content is validated by note-rules.mjs (fields, 3–5
 * consecutive contexts, plain text with the target word, Chinese where Chinese is required, and every
 * other word inside CEFR A2 unless --no-level-check).
 *
 * Usage:
 *   node rewrite-existing.mjs /absolute/path/to/notes.json --deck DECK [--dry-run] [--confirmed]
 *     [--without-tts] [--strict-level] [--no-level-check] [--anki-connect-url URL]
 *     [--backup-dir DIR] [--tts minimax --minimax-voice VOICE_ID] [--minimax-model MODEL]
 *     [--minimax-speed NUMBER] [--minimax-min-interval-ms NUMBER] [--minimax-api-key-env NAME]
 *     [--minimax-keychain-service NAME] [--minimax-env-file PATH] [--minimax-endpoint URL]
 *     [--media-prefix PREFIX]
 *
 * Fields you omit are left as they are; an empty string also means "leave it as it is". Context slots
 * beyond the new sentence count are cleared (and their audio deleted).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cleanSpeechText, createMediaFilename, MINIMAX_TTS_ENDPOINT, synthesizeMiniMax } from "./minimax-tts.mjs";
import { getMiniMaxApiKey } from "./minimax-credentials.mjs";
import { loadCefrList } from "./level-check.mjs";
import { loadLexicon } from "./lexicon.mjs";
import {
  AUDIO_FIELDS, BASE_REQUIRED_FIELDS, CONTEXT_FIELDS, OPTIONAL_TEXT_FIELDS, THEME_FIELD,
  assert, isFilledString, normalizeTheme, normalizeWord, validateNote
} from "./note-rules.mjs";

const DEFAULT_API_URL = "http://127.0.0.1:8766";
const DEFAULT_MODEL_NAME = process.env.ANKI_FLASHCARD_MODEL || "微语境闪卡 1.0";
const DEFAULT_BACKUP_DIR = join(homedir(), ".hermes", "cache", "anki-flashcard", "backups");
const usage = "Usage: node rewrite-existing.mjs /absolute/path/to/notes.json --deck DECK [--dry-run] [--confirmed] [--without-tts] [--strict-level] [--no-level-check] [--anki-connect-url URL] [--backup-dir DIR] [--tts minimax --minimax-voice VOICE_ID] [--minimax-model MODEL] [--minimax-speed NUMBER] [--minimax-min-interval-ms NUMBER] [--minimax-api-key-env NAME] [--minimax-keychain-service NAME] [--minimax-env-file PATH] [--minimax-endpoint URL] [--media-prefix PREFIX]";

const [inputPath, ...options] = process.argv.slice(2);
let dryRun = false;
let confirmed = false;
let strictLevel = false;
let levelCheck = true;
let deckName = "";
let backupDir = DEFAULT_BACKUP_DIR;
let apiUrl = process.env.ANKI_CONNECT_URL || DEFAULT_API_URL;
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
  if (option === "--dry-run") { dryRun = true; continue; }
  if (option === "--confirmed") { confirmed = true; continue; }
  if (option === "--without-tts") { tts.enabled = false; continue; }
  if (option === "--strict-level") { strictLevel = true; continue; }
  if (option === "--no-level-check") { levelCheck = false; continue; }
  const value = options[index + 1];
  if (!value || value.startsWith("--")) throw new Error(usage);
  if (option === "--deck") deckName = value;
  else if (option === "--anki-connect-url") apiUrl = value;
  else if (option === "--backup-dir") backupDir = value;
  else if (option === "--tts") { assert(value === "minimax", `Unsupported --tts provider: ${value}`); tts.provider = value; }
  else if (option === "--minimax-voice") tts.voiceId = value;
  else if (option === "--minimax-model") tts.model = value;
  else if (option === "--minimax-speed") tts.speed = Number(value);
  else if (option === "--minimax-min-interval-ms") tts.minIntervalMs = Number(value);
  else if (option === "--minimax-api-key-env") tts.apiKeyEnv = value;
  else if (option === "--minimax-keychain-service") tts.keychainService = value;
  else if (option === "--minimax-env-file") tts.envFile = value;
  else if (option === "--minimax-endpoint") tts.endpoint = value;
  else if (option === "--media-prefix") tts.mediaPrefix = value;
  else throw new Error(usage);
  index += 1;
}
assert(deckName.trim(), `--deck is required. ${usage}`);

const invoke = async (action, params = {}) => {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params })
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`AnkiConnect ${action}: ${payload.error}`);
  return payload.result;
};
const escapeQuery = (value) => String(value).replace(/[\\"]/g, "\\$&");
const fieldValue = (fields, name) => (fields[name]?.value ?? "");
/** Audio fields hold a bare media filename; tolerate a legacy [sound:...] wrapper. */
const mediaName = (value) => {
  const match = /\[sound:([^\]]+)\]/.exec(String(value || ""));
  return match ? match[1] : String(value || "").trim();
};

const input = JSON.parse(await readFile(inputPath, "utf8"));
const modelName = typeof input.modelName === "string" && input.modelName.trim() ? input.modelName.trim() : DEFAULT_MODEL_NAME;
assert(!input.deckName || !String(input.deckName).trim() || String(input.deckName).trim() === deckName.trim(),
  `input.deckName (${input.deckName}) does not match --deck (${deckName}).`);
assert(Array.isArray(input.notes) && input.notes.length, "notes must be a non-empty array.");

const warnings = [];
const levelFailures = [];
const noteWords = new Set();
// 例句难度门：除目标词以外必须落在 CEFR A2 以内（见 references/example-design.md）
const cefr = levelCheck ? await loadCefrList() : { levels: new Map(), allowed: new Set() };
const lexicon = await loadLexicon();

/** Complete context groups present on a note, without the 3–5 rule (partial input is legal here). */
const suppliedContexts = (note) => {
  let count = 0;
  for (let index = 1; index <= 5; index += 1) {
    if (CONTEXT_FIELDS(index).every((field) => isFilledString(note[field]))) count = index;
    else break;
  }
  return count;
};

const [models, decks] = await Promise.all([invoke("modelNames"), invoke("deckNames")]);
assert(models.includes(modelName), `Missing Anki model: ${modelName}`);
assert(decks.includes(deckName), `Deck does not exist: ${deckName}`);

// Notes to rewrite: by Word, inside the chosen deck. Media safety check: the whole model.
const deckNoteIds = await invoke("findNotes", { query: `deck:"${escapeQuery(deckName)}" note:"${escapeQuery(modelName)}"` });
const modelNoteIds = await invoke("findNotes", { query: `note:"${escapeQuery(modelName)}"` });
const [deckNotes, modelNotes] = await Promise.all([
  deckNoteIds.length ? invoke("notesInfo", { notes: deckNoteIds }) : [],
  modelNoteIds.length ? invoke("notesInfo", { notes: modelNoteIds }) : []
]);
const byWord = new Map(deckNotes.map((note) => [normalizeWord(fieldValue(note.fields, "Word")), note]));
// Media present before the rewrite: a clip is only reused when it is referenced AND really on disk.
const plannedMedia = new Set(await invoke("getMediaFilesNames", { pattern: "*" }));

const plans = input.notes.map((note, noteIndex) => {
  const word = note.Word.trim();
  const target = byWord.get(normalizeWord(word));
  assert(target, `No ${modelName} note with Word "${word}" in deck ${deckName}. Use import-vocabulary.mjs to add new words.`);
  const current = Object.fromEntries(Object.entries(target.fields).map(([name, field]) => [name, field.value]));
  // 输入没给语境就沿用卡上现有的组数：只改 ChineseCore 时不得把例句清空。
  const contextCount = suppliedContexts(note) || suppliedContexts(current);
  const next = {};
  const changes = [];

  // Plain text fields: only what the input provides, never blanking an existing value by accident.
  for (const field of [...BASE_REQUIRED_FIELDS, THEME_FIELD, ...OPTIONAL_TEXT_FIELDS]) {
    if (!isFilledString(note[field])) continue;
    const value = field === THEME_FIELD ? normalizeTheme(note[field]) : String(note[field]).trim();
    if (value !== current[field]) changes.push({ field, from: current[field], to: value });
    next[field] = value;
  }
  for (let index = 1; index <= 5; index += 1) {
    const fields = CONTEXT_FIELDS(index);
    if (index <= contextCount) {
      for (const field of fields) {
        const value = String(note[field] ?? current[field] ?? "").trim();
        if (value !== current[field]) changes.push({ field, from: current[field], to: value });
        next[field] = value;
      }
    } else if (isFilledString(current[fields[0]])) {
      for (const field of fields) {
        changes.push({ field, from: current[field], to: "" });
        next[field] = "";
      }
    }
  }

  // Audio: the filename is derived from the spoken text, so an unchanged sentence keeps its file.
  const spokenWord = next.Word ?? current.Word;
  const audio = [
    { field: "WordAudio", slot: "word", text: cleanSpeechText(spokenWord) },
    ...Array.from({ length: contextCount }, (_, index) => ({
      field: `AudioSentence${index + 1}`,
      slot: `sentence-${index + 1}`,
      text: cleanSpeechText(next[`Sentence${index + 1}`] ?? current[`Sentence${index + 1}`])
    }))
  ].map((source) => {
    const filename = createMediaFilename({
      word: spokenWord, slot: source.slot, text: source.text, model: tts.model, voiceId: tts.voiceId,
      speed: tts.speed, prefix: tts.mediaPrefix
    });
    // Reuse only a clip that is both referenced by the field and really present in the collection.
    const state = mediaName(current[source.field]) === filename && plannedMedia.has(filename) ? "reuse" : "new";
    if (state === "new") next[source.field] = filename;
    return { field: source.field, filename, state, text: source.text };
  });

  // Media this rewrite replaces or drops — deleted only when no other note in the model still uses it.
  const keep = new Set(audio.map((item) => item.filename));
  const stale = AUDIO_FIELDS.map((field) => mediaName(current[field])).filter((name) => name && !keep.has(name));
  const mediaToDelete = [...new Set(stale)].filter((name) => !modelNotes.some(
    (other) => other.noteId !== target.noteId && Object.values(other.fields).some((field) => mediaName(field.value) === name)
  ));

  return { word, noteId: target.noteId, contextCount, changes, audio, mediaToDelete, current, next };
});

// 校验**合并后**的笔记，不是输入本身：只改 ChineseCore 时输入里没有 IPA、例句这些必填字段，
// 拿输入去跑完整校验会误报"字段缺失"，逼调用方把 17 个字段全量重传一遍。
plans.forEach((plan, noteIndex) => {
  // 写回后的真实状态 = 现值打底 + 本次改动（输入里没给的字段沿用现值，不是空）
  const merged = { ...plan.current, ...plan.next };
  const counted = validateNote(merged, noteIndex, {
    warnings, levelFailures, levelCheck, strictLevel, cefr, seenWords: noteWords, lexicon,
  });
  assert(counted === plan.contextCount, `${plan.word}: 合并后是 ${counted} 组语境，与计划的 ${plan.contextCount} 组不一致。`);
});
assert(!levelFailures.length, `${levelFailures.join("；")}\n例句里除目标词以外的词必须保持在 CEFR A2 以内（确需收录更难的句子时用 --no-level-check 关闭该校验）。`);

if (!confirmed) {
  console.log(JSON.stringify({
    dryRun: true,
    deckName,
    modelName,
    tts: tts.enabled ? { provider: tts.provider, voiceId: tts.voiceId, model: tts.model, speed: tts.speed } : null,
    notes: plans.map((plan) => ({
      word: plan.word,
      noteId: plan.noteId,
      contextCount: plan.contextCount,
      changes: plan.changes,
      audio: plan.audio.map(({ field, filename, state }) => ({ field, filename, state })),
      mediaToDelete: plan.mediaToDelete
    })),
    warnings
  }, null, 2));
  if (!dryRun) console.log("Refusing unconfirmed rewrite: review the plan above, then re-run with --confirmed to apply it.");
  process.exit(0);
}
assert(!dryRun, "--dry-run and --confirmed cannot be combined.");
assert(tts.enabled, "--confirmed requires TTS: without it the audio fields would point at files that do not exist.");

// Snapshot what the notes look like now, so a bad rewrite can be rolled back.
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
const backupPath = join(backupDir, `${stamp}-${plans.map((plan) => normalizeWord(plan.word).replace(/\s+/g, "-")).join("_")}.json`);
await writeFile(backupPath, JSON.stringify({
  modelName,
  deckName,
  createdAt: new Date().toISOString(),
  notes: modelNotes.filter((note) => plans.some((plan) => plan.noteId === note.noteId)).map((note) => ({
    noteId: note.noteId,
    cards: note.cards,
    fields: Object.fromEntries(Object.entries(note.fields).map(([name, field]) => [name, field.value]))
  }))
}, null, 2));

const apiKey = await getMiniMaxApiKey({ envName: tts.apiKeyEnv, keychainService: tts.keychainService, envFile: tts.envFile });
const results = [];
for (const plan of plans) {
  for (const item of plan.audio) {
    if (item.state !== "new") continue;
    const audio = await synthesizeMiniMax({
      apiKey, endpoint: tts.endpoint, text: item.text, model: tts.model, voiceId: tts.voiceId,
      speed: tts.speed, minIntervalMs: tts.minIntervalMs
    });
    // synthesizeMiniMax returns { audioBase64, usageCharacters } — a tiny payload means the API
    // answered without audio and must never be written as the card's clip.
    assert(typeof audio?.audioBase64 === "string" && audio.audioBase64.length > 1000,
      `MiniMax returned no usable audio for ${plan.word} ${item.field} (${audio?.audioBase64?.length ?? 0} base64 chars).`);
    await invoke("storeMediaFile", { filename: item.filename, data: audio.audioBase64 });
  }
  await invoke("updateNoteFields", { note: { id: plan.noteId, fields: plan.next } });
  const deleted = [];
  for (const filename of plan.mediaToDelete) {
    await invoke("deleteMediaFile", { filename });
    deleted.push(filename);
  }
  results.push({
    word: plan.word,
    noteId: plan.noteId,
    fieldsWritten: Object.keys(plan.next).length,
    audioGenerated: plan.audio.filter((item) => item.state === "new").map((item) => item.filename),
    audioReused: plan.audio.filter((item) => item.state === "reuse").map((item) => item.filename),
    mediaDeleted: deleted
  });
}

// Read back: every field we wrote is on the card, and every audio file Anki should hold is there.
const readback = await invoke("notesInfo", { notes: plans.map((plan) => plan.noteId) });
const mediaNames = new Set(await invoke("getMediaFilesNames", { pattern: "*" }));
const verified = plans.map((plan) => {
  const note = readback.find((entry) => entry.noteId === plan.noteId);
  const problems = [];
  for (const [field, value] of Object.entries(plan.next)) {
    const actual = fieldValue(note.fields, field);
    if (actual !== value) problems.push(`${field}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
  }
  const missingMedia = plan.audio.map((item) => item.filename).filter((filename) => !mediaNames.has(filename));
  if (missingMedia.length) problems.push(`missing media: ${missingMedia.join("、")}`);
  return { word: plan.word, noteId: plan.noteId, ok: !problems.length, problems };
});
const failed = verified.filter((entry) => !entry.ok);
console.log(JSON.stringify({
  dryRun: false,
  deckName,
  modelName,
  backupPath,
  notes: results,
  verified: verified.length,
  failed: failed.length,
  failures: failed,
  warnings
}, null, 2));
assert(!failed.length, `Rewrite verification failed: ${JSON.stringify(failed)}`);
