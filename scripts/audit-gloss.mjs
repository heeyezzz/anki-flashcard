#!/usr/bin/env node
/**
 * anki-flashcard — read-only review list: dictionary floor vs what each card actually shows.
 *
 * For every note in the deck it recomputes the ECDICT floor (`dictionaryCore`) and reports the
 * senses whose characters barely overlap the card's `ChineseCore` + `OtherMeanings`.
 *
 * THIS IS NOT A GATE. The overlap test is a heuristic and it misfires on legitimate rewording —
 * 地板"战栗" vs 卡面"颤抖", 地板"该得到" vs 卡面"应得" — which is exactly why the note type has no
 * automated coverage check (see SKILL.md: the two strings are compared side by side at approval
 * instead). Read the output, decide per card, then fix content with rewrite-existing.mjs.
 *
 * Nothing here writes: no notes, no media, no templates.
 * usage: node audit-gloss.mjs [--deck NAME] [--word WORD]
 */
import { dictionaryCore, loadLexicon } from "./lexicon.mjs";

const API_URL = process.env.ANKI_CONNECT_URL || "http://127.0.0.1:8766";
const MODEL_NAME = process.env.ANKI_FLASHCARD_MODEL || "微语境闪卡 1.0";
const usage = "Usage: node audit-gloss.mjs [--deck NAME] [--word WORD]";
const options = process.argv.slice(2);
const config = { deck: "all in one::微语境闪卡", word: "" };
for (let index = 0; index < options.length; index += 1) {
  const value = options[index + 1];
  if (!value || value.startsWith("--")) throw new Error(usage);
  if (options[index] === "--deck") config.deck = value;
  else if (options[index] === "--word") config.word = value;
  else throw new Error(usage);
  index += 1;
}

const invoke = async (action, params = {}) => {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`AnkiConnect ${action}: ${payload.error}`);
  return payload.result;
};

const query = `deck:"${config.deck}" note:"${MODEL_NAME}"${config.word ? ` "${config.word}"` : ""}`;
const noteIds = await invoke("findNotes", { query });
if (!noteIds.length) throw new Error(`没有命中任何笔记：${query}`);
const notes = (await invoke("notesInfo", { notes: noteIds })).map((note) =>
  Object.fromEntries(Object.entries(note.fields).map(([name, detail]) => [name, detail.value])));
const lexicon = await loadLexicon();
if (!lexicon.present) throw new Error(`精简词典表不可用（${lexicon.path}）；先跑 scripts/build-lexicon-assets.mjs`);

const hanzi = (text) => (String(text).match(/[㐀-鿿]/g) || []);
const rows = [];
for (const fields of notes) {
  const word = fields.Word.trim();
  const entry = lexicon.entries.get(word.toLowerCase());
  if (!entry) { rows.push({ word, kind: "不在精简表里", note: "跑 build-lexicon-assets.mjs 刷新后重试" }); continue; }
  const floor = dictionaryCore({ raw: entry.raw });
  if (!floor || !floor.usable) { rows.push({ word, kind: "地板不可用", note: floor?.reason || "无输出", card: fields.ChineseCore }); continue; }
  const cardChars = new Set(hanzi(`${fields.ChineseCore} ${fields.OtherMeanings || ""}`));
  const senses = floor.core.replace(/^[a-z]+\.\s*/i, "").split(/[，；]/).map((s) => s.trim()).filter(Boolean);
  const missing = senses.filter((gloss) => {
    const chars = hanzi(gloss.replace(/^[a-z]+\.\s*/i, ""));
    return chars.length > 0 && chars.filter((ch) => cardChars.has(ch)).length / chars.length < 0.5;
  });
  rows.push({
    word,
    kind: missing.length ? "地板有、卡面查不到" : "ok",
    floor: floor.core,
    card: fields.ChineseCore,
    other: (fields.OtherMeanings || "").split("\n")[0].slice(0, 46),
    missing,
  });
}

const flagged = rows.filter((row) => row.kind !== "ok");
console.log(`共 ${rows.length} 张：干净 ${rows.length - flagged.length} 张，需人工看 ${flagged.length} 张`);
console.log("提示：下面是启发式清单，同义改写会被误报（地板「战栗」 vs 卡面「颤抖」），不是导入闸门。\n");
for (const row of flagged.sort((a, b) => (b.missing?.length || 0) - (a.missing?.length || 0))) {
  console.log(`· ${row.word}  [${row.kind}]`);
  console.log(`    卡面  : ${row.card}`);
  if (row.note) { console.log(`    说明  : ${row.note}`); continue; }
  console.log(`    地板  : ${row.floor}`);
  if (row.other) console.log(`    其他义: ${row.other}`);
  console.log(`    查不到: ${row.missing.join("、")}`);
  console.log();
}
