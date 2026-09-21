#!/usr/bin/env node
/**
 * anki-context — independent verification of imported 微语境闪卡 notes.
 *
 * Checks each note against the note type's contract and against the *rendered* card:
 *   1. the input fields are present;
 *   2. audio follows the sentences (populated slots have files, empty slots do not);
 *   3. every stored filename really exists in the media collection;
 *   4. exactly one card per note;
 *   5. the question side renders the word, the IPA and the sentences — and no answer.
 *
 * The rendered checks use Agent Connect's renderCard (format="text"), which runs the card through
 * Anki's own template pipeline and returns visible text only — no stylesheet or script payload to
 * strip, so answer-field names in CSS comments cannot produce false positives. Field comparisons use
 * full values, because an Analysis line legitimately quotes a collocation already in the sentence.
 *
 * usage: node verify-import.mjs --deck DECK_NAME [--word WORD] [--anki-connect-url URL]
 */
import { findAboveLevel, loadCefrList, targetFormsOf } from "./level-check.mjs";

const API_URL = process.env.ANKI_CONNECT_URL || "http://127.0.0.1:8766";
const MODEL_NAME = process.env.ANKI_CONTEXT_MODEL || "微语境闪卡 1.0";
const usage = "Usage: node verify-import.mjs --deck DECK_NAME [--word WORD] [--fail-on-level] [--anki-connect-url URL]";
const options = process.argv.slice(2);
const config = { deckName: "", word: "", apiUrl: API_URL, failOnLevel: false };
for (let index = 0; index < options.length; index += 1) {
  const option = options[index];
  if (option === "--fail-on-level") {
    config.failOnLevel = true;
    continue;
  }
  const value = options[index + 1];
  if (!value || value.startsWith("--")) throw new Error(usage);
  if (option === "--deck") config.deckName = value;
  else if (option === "--word") config.word = value;
  else if (option === "--anki-connect-url") config.apiUrl = value;
  else throw new Error(usage);
  index += 1;
}
if (!config.deckName) throw new Error(usage);

const invoke = async (action, params = {}) => {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params })
  });
  if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`AnkiConnect ${action}: ${payload.error}`);
  return payload.result;
};

const escapeQuery = (value) => value.replace(/[\\"]/g, "\\$&");
const renderedText = (html) => html
  .replace(/<style[\s\S]*?<\/style>/g, " ")
  .replace(/<script[\s\S]*?<\/script>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const models = await invoke("modelNames");
if (!models.includes(MODEL_NAME)) throw new Error(`Missing Anki model: ${MODEL_NAME}`);
const query = `deck:"${escapeQuery(config.deckName)}" note:"${MODEL_NAME}"`
  + (config.word ? ` "${escapeQuery(config.word)}"` : "");
const noteIds = await invoke("findNotes", { query });
if (!noteIds.length) throw new Error(`No ${MODEL_NAME} notes found for: ${query}`);
const notes = await invoke("notesInfo", { notes: noteIds });
const cefr = await loadCefrList();

const results = [];
for (const note of notes) {
  const fields = Object.fromEntries(Object.entries(note.fields).map(([key, value]) => [key, value.value.trim()]));
  const word = fields.Word;
  const problems = [];
  const notes_ = [];

  for (const field of ["Word", "IPA", "ChineseCore"]) {
    if (!fields[field]) problems.push(`missing ${field}`);
  }
  const slots = [];
  let gap = false;
  for (let index = 1; index <= 5; index += 1) {
    const populated = ["Sentence", "Meaning", "SentenceCN", "Analysis"].map((prefix) => fields[`${prefix}${index}`]);
    if (!populated.some(Boolean)) { gap = true; continue; }
    if (gap) problems.push(`Sentence${index} follows an empty group`);
    if (!populated.every(Boolean)) problems.push(`group ${index} is incomplete`);
    slots.push(index);
  }
  if (!slots.length) problems.push("no sentences");

  if (!fields.WordAudio) problems.push("missing WordAudio");
  for (const index of slots) {
    if (!fields[`AudioSentence${index}`]) problems.push(`missing AudioSentence${index}`);
  }
  for (let index = 1; index <= 5; index += 1) {
    if (!slots.includes(index) && fields[`AudioSentence${index}`]) problems.push(`AudioSentence${index} is set for an empty sentence`);
  }
  // 语音文件不仅要存在，还要有真实体量：一个字音约 6–16 KB，一句约 20–70 KB。
  // 只有"文件存在"这一条时，9 字节的垃圾数据也能通过验收（真实踩过）。
  const MIN_AUDIO_BYTES = 2048;
  for (const field of ["WordAudio", ...slots.map((index) => `AudioSentence${index}`)]) {
    if (!fields[field]) continue;
    const payload = await invoke("retrieveMediaFile", { filename: fields[field] });
    if (!payload) {
      problems.push(`media file not found: ${fields[field]}`);
      continue;
    }
    const bytes = Math.floor(String(payload).length * 3 / 4);
    if (bytes < MIN_AUDIO_BYTES) problems.push(`media file looks corrupt: ${fields[field]} is ${bytes} bytes (expected at least ${MIN_AUDIO_BYTES})`);
  }
  if (!/^\//.test(fields.IPA || "")) notes_.push(`IPA does not use slashes: ${fields.IPA}`);

  // 例句难度审计：默认只报告（老卡可能本来就高于 A2），--fail-on-level 时算失败。
  const levelIssues = [];
  for (const index of slots) {
    const above = findAboveLevel(fields[`Sentence${index}`], {
      targetForms: targetFormsOf(word), levels: cefr.levels, allowed: cefr.allowed
    });
    if (above.length) {
      levelIssues.push(`Sentence${index}: ${above.map(({ token, level }) => `${token} (${level})`).join("、")}`);
    }
  }
  if (config.failOnLevel && levelIssues.length) problems.push(`above A2: ${levelIssues.join("; ")}`);

  if (note.cards.length !== 1) problems.push(`expected exactly one card, found ${note.cards.length}`);
  const card = note.cards.length ? (await invoke("renderCard", { cardIds: [note.cards[0]], format: "text" })).cards[0] : null;
  if (card) {
    const text = renderedText(card.question);
    const answers = { ChineseCore: fields.ChineseCore, OtherMeanings: fields.OtherMeanings };
    for (const index of slots) {
      answers[`Meaning${index}`] = fields[`Meaning${index}`];
      answers[`SentenceCN${index}`] = fields[`SentenceCN${index}`];
      answers[`Analysis${index}`] = fields[`Analysis${index}`];
    }
    const leaks = Object.entries(answers).filter(([, value]) => value.length >= 4 && text.includes(value)).map(([field]) => field);
    if (leaks.length) problems.push(`answer visible on the question side: ${leaks.join(", ")}`);
    if (!text.includes(word)) problems.push("word is not rendered on the question side");
    if (fields.IPA && !text.includes(fields.IPA)) problems.push("IPA is not rendered on the question side");
    if (fields.WordAudio && !text.includes(fields.WordAudio)) problems.push("word audio path is not in the question DOM");
    for (const index of slots) {
      if (!text.includes(fields[`Sentence${index}`])) problems.push(`Sentence${index} is not in the question DOM`);
    }
  }

  results.push({ word, noteId: note.noteId, cardId: note.cards[0] ?? null, slots: slots.length, levelIssues, problems, notes: notes_ });
}

const failed = results.filter((result) => result.problems.length);
console.log(JSON.stringify({
  ankiConnectUrl: config.apiUrl,
  modelName: MODEL_NAME,
  deckName: config.deckName,
  verified: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results
}, null, 2));
if (failed.length) process.exit(1);
