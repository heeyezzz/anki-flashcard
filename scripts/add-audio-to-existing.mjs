#!/usr/bin/env node
/**
 * anki-flashcard — fill missing audio on 微语境闪卡 1.0 notes already in a deck:
 * 单词默认走有道词典录音（--word-tts），例句仍走 MiniMax。
 * Never overwrites a filename that is already stored, unless --refresh asks for it.
 */
import { cleanSpeechText, createMediaFilename, MINIMAX_TTS_ENDPOINT, synthesizeMiniMax } from "./minimax-tts.mjs";
import { getMiniMaxApiKey } from "./minimax-credentials.mjs";
import { noteYoudaoNormalization, synthesizeYoudao, wordAudioSource, WORD_TTS_CHOICES } from "./youdao-tts.mjs";

const API_URL = process.env.ANKI_CONNECT_URL || "http://127.0.0.1:8766";
const MODEL_NAME = process.env.ANKI_FLASHCARD_MODEL || "微语境闪卡 1.0";
const AUDIO_FIELDS = ["WordAudio", ...Array.from({ length: 5 }, (_, index) => `AudioSentence${index + 1}`)];
const usage = "Usage: node add-audio-to-existing.mjs --deck DECK_NAME --minimax-voice VOICE_ID [--word WORD] [--refresh] [--dry-run] [--minimax-model MODEL] [--minimax-speed NUMBER] [--minimax-min-interval-ms NUMBER] [--minimax-api-key-env NAME] [--minimax-keychain-service NAME] [--minimax-env-file PATH] [--minimax-endpoint URL] [--media-prefix PREFIX] [--word-tts youdao|youdao-us|minimax]";
const options = process.argv.slice(2);
const config = {
  deckName: "", word: "", refresh: false, dryRun: false, voiceId: "", model: "speech-2.8-hd", speed: 1,
  minIntervalMs: 11000, apiKeyEnv: "MINIMAX_API_KEY", keychainService: "anki-minimax-tts", envFile: "",
  endpoint: MINIMAX_TTS_ENDPOINT, mediaPrefix: "minimax",
  // 单词发音默认走有道词典录音；例句永远走 MiniMax。
  wordTts: "youdao"
};
for (let index = 0; index < options.length; index += 1) {
  const option = options[index];
  const value = options[index + 1];
  if (option === "--refresh") { config.refresh = true; continue; }
  if (option === "--dry-run") { config.dryRun = true; continue; }
  if (!value || value.startsWith("--")) throw new Error(usage);
  if (option === "--deck") config.deckName = value;
  else if (option === "--word") config.word = value;
  else if (option === "--minimax-voice") config.voiceId = value;
  else if (option === "--minimax-model") config.model = value;
  else if (option === "--minimax-speed") config.speed = Number(value);
  else if (option === "--minimax-min-interval-ms") config.minIntervalMs = Number(value);
  else if (option === "--minimax-api-key-env") config.apiKeyEnv = value;
  else if (option === "--minimax-keychain-service") config.keychainService = value;
  else if (option === "--minimax-env-file") config.envFile = value;
  else if (option === "--minimax-endpoint") config.endpoint = value;
  else if (option === "--media-prefix") config.mediaPrefix = value;
  else if (option === "--word-tts") {
    if (!WORD_TTS_CHOICES.includes(value)) throw new Error(`--word-tts 只能是 ${WORD_TTS_CHOICES.join("、")}。`);
    config.wordTts = value;
  }
  else throw new Error(usage);
  index += 1;
}
if (!config.deckName || !config.voiceId || !Number.isFinite(config.speed) || config.speed <= 0 || !Number.isFinite(config.minIntervalMs) || config.minIntervalMs < 0) throw new Error(usage);
if (!/^[a-z0-9-]+$/.test(config.mediaPrefix)) throw new Error(`${usage}\n--media-prefix accepts lowercase letters, digits, and hyphens.`);

const invoke = async (action, params = {}) => {
  const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: 6, params }) });
  if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`AnkiConnect ${action}: ${payload.error}`);
  return payload.result;
};

const populatedContexts = (note) => {
  const slots = [];
  let foundGap = false;
  for (let index = 1; index <= 5; index += 1) {
    const sentence = note.fields[`Sentence${index}`]?.value?.trim();
    if (!sentence) {
      foundGap = true;
      continue;
    }
    if (foundGap) throw new Error(`${note.fields.Word.value} has a non-consecutive Sentence${index}.`);
    slots.push(index);
  }
  if (!slots.length) throw new Error(`${note.fields.Word.value} has no sentences to voice.`);
  return slots;
};

const fields = await invoke("modelFieldNames", { modelName: MODEL_NAME });
const missing = AUDIO_FIELDS.filter((field) => !fields.includes(field));
if (missing.length) throw new Error(`Model is missing TTS fields: ${missing.join("、")}。请先运行 scripts/ensure-audio-fields.mjs 检查。`);

const noteIds = await invoke("findNotes", { query: `deck:\"${config.deckName.replace(/[\\\"]/g, "\\$&")}\" note:\"${MODEL_NAME}\"${config.word ? ` \"${config.word.replace(/[\\\"]/g, "\\$&")}\"` : ""}` });
const notes = noteIds.length ? await invoke("notesInfo", { notes: noteIds }) : [];
if (!notes.length) throw new Error(`No ${MODEL_NAME} notes found in deck: ${config.deckName}`);
if (config.word && notes.length !== 1) throw new Error(`Expected exactly one ${config.word} note in ${config.deckName}, found ${notes.length}.`);

const warnings = [];
// 音频字段可能存裸文件名，也可能存 [sound:…]，比较前先统一成文件名。
const mediaName = (value) => {
  const match = /\[sound:([^\]]+)\]/.exec(String(value || ""));
  return match ? match[1] : String(value || "").trim();
};
const plan = [];
for (const note of notes) {
  const word = note.fields.Word.value.trim();
  const slots = populatedContexts(note);
  if (slots.length < 3) warnings.push(`${word} has only ${slots.length} sentence(s); the card still works but 3–5 contexts are the intended design.`);
  const sentence = (slot) => cleanSpeechText(note.fields[`Sentence${slot}`].value);
  const targets = [
    { field: "WordAudio", slot: "word", text: cleanSpeechText(word), ...wordAudioSource(config.wordTts, config) },
    ...slots.map((slot) => ({ field: `AudioSentence${slot}`, slot: `sentence-${slot}`, text: sentence(slot),
      provider: "minimax", model: config.model, voiceId: config.voiceId, speed: config.speed, prefix: config.mediaPrefix }))
  ].map((target) => {
    const filename = createMediaFilename({
      word, slot: target.slot, text: target.text, model: target.model,
      voiceId: target.voiceId, speed: target.speed, prefix: target.prefix
    });
    const stored = note.fields[target.field]?.value?.trim() || "";
    // Refill when the field is empty, or when --refresh says the stored file no longer matches
    // the current text (an edited sentence, or audio written by an older script variant).
    const needed = !stored || (config.refresh && stored !== filename);
    return { ...target, stored, filename, needed };
  });
  plan.push({ noteId: note.noteId, word, slots, targets });
}

const todo = plan.filter((entry) => entry.targets.some((target) => target.needed));
const plannedNew = [];
for (const entry of todo) {
  for (const target of entry.targets) {
    if (!target.needed) continue;
    const exists = await invoke("retrieveMediaFile", { filename: target.filename });
    plannedNew.push({ word: entry.word, field: target.field, filename: target.filename, state: exists ? "reused" : "new" });
  }
}

if (config.dryRun) {
  const replaced = [];
  for (const entry of todo) {
    for (const target of entry.targets) {
      if (target.needed && target.stored && target.stored !== target.filename) {
        replaced.push({ word: entry.word, field: target.field, wouldDelete: target.stored });
      }
    }
  }
  console.log(JSON.stringify({
    dryRun: true, modelName: MODEL_NAME, deckName: config.deckName,
    notesInDeck: notes.length, notesNeedingAudio: todo.length,
    planned: plannedNew, replacedAudio: replaced, warnings
  }, null, 2));
  process.exit(0);
}
if (!todo.length) {
  console.log(JSON.stringify({ deckName: config.deckName, modelName: MODEL_NAME, completed: [], message: "No notes require TTS." }, null, 2));
  process.exit(0);
}

let apiKey = "";
let generatedCharacters = 0;
const replacedMedia = new Map();
for (const entry of todo) {
  const updates = Object.fromEntries(AUDIO_FIELDS.map((field) => [field, ""]));
  for (const target of entry.targets) {
    if (target.needed && !await invoke("retrieveMediaFile", { filename: target.filename })) {
      const clip = target.provider === "youdao"
        // 免费词典录音：拉不到就抛错停下，绝不静默改用付费合成。
        ? await synthesizeYoudao({ text: target.text, accent: target.accent })
        : await (async () => {
          apiKey ||= await getMiniMaxApiKey(config);
          return synthesizeMiniMax({ apiKey, endpoint: config.endpoint, text: target.text, model: target.model, voiceId: target.voiceId, speed: target.speed, minIntervalMs: config.minIntervalMs });
        })();
      await invoke("storeMediaFile", { filename: target.filename, data: clip.audioBase64 });
      noteYoudaoNormalization(clip, warnings);
      generatedCharacters += clip.usageCharacters ?? 0;
    }
    updates[target.field] = target.filename;
    if (target.stored && target.stored !== target.filename) {
      replacedMedia.set(target.stored, `${entry.word}.${target.field}`);
    }
  }
  await invoke("updateNoteFields", { note: { id: entry.noteId, fields: updates } });
}

// 换下来的旧音频：只有整个笔记类型里再没有别的卡引用它才删，否则留着并报出来。
const mediaDeleted = [];
if (replacedMedia.size) {
  const rewritten = new Set(todo.map((entry) => entry.noteId));
  const otherIds = (await invoke("findNotes", { query: `note:"${MODEL_NAME}"` })).filter((id) => !rewritten.has(id));
  const otherNotes = otherIds.length ? await invoke("notesInfo", { notes: otherIds }) : [];
  for (const [name, usedBy] of replacedMedia) {
    if (otherNotes.some((note) => Object.values(note.fields).some((field) => mediaName(field.value) === name))) {
      warnings.push(`${name} 仍被别的笔记引用，保留（本次由 ${usedBy} 换下）`);
      continue;
    }
    await invoke("deleteMediaFile", { filename: name });
    mediaDeleted.push(name);
  }
}

const verified = await invoke("notesInfo", { notes: todo.map((entry) => entry.noteId) });
for (const note of verified) {
  const entry = todo.find((candidate) => candidate.noteId === note.noteId);
  for (const target of entry.targets) {
    const stored = note.fields[target.field]?.value?.trim();
    if (!stored) throw new Error(`Readback mismatch for ${entry.word}.${target.field}`);
    if (!await invoke("retrieveMediaFile", { filename: stored })) throw new Error(`Stored audio is missing from the media collection: ${entry.word}.${target.field} -> ${stored}`);
  }
  for (let index = 1; index <= 5; index += 1) {
    if (!entry.slots.includes(index) && note.fields[`AudioSentence${index}`]?.value) {
      throw new Error(`Unexpected audio for empty ${entry.word}.Sentence${index}.`);
    }
  }
}
console.log(JSON.stringify({
  deckName: config.deckName, modelName: MODEL_NAME,
  completed: verified.map((note) => ({ noteId: note.noteId, word: note.fields.Word.value })),
  newlyGeneratedCharacters: generatedCharacters, mediaDeleted, warnings
}, null, 2));
