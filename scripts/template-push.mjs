#!/usr/bin/env node
/**
 * anki-flashcard — snapshot / check / push the 微语境闪卡 1.0 templates and CSS.
 *
 * Editing a note type is collection-wide and destructive, so this enforces the procedure:
 *   --snapshot  dump the live Front/Back/CSS to disk (rollback point)
 *   --check     compare live against the local copies, write nothing
 *   --push      verify live still equals the committed baseline (nobody edited it in Anki),
 *               then updateModelTemplates (whole map) + updateModelStyling, then read both back
 *               and require byte equality with the LOCAL files — comparing against the pre-push
 *               snapshot would also pass when the push silently did nothing.
 *
 * Templates are render-side only: this never touches notes, fields or media.
 * usage: node template-push.mjs --snapshot | --check | --push [--dir NAME]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const TEMPLATES = path.join(REPO, "templates", "微语境闪卡-1.0");
const MODEL_NAME = process.env.ANKI_FLASHCARD_MODEL || "微语境闪卡 1.0";
const TEMPLATE_NAME = "微语境闪卡";
const FILES = { Front: "Front.html", Back: "Back.html", css: "style.css" };
const API_URL = process.env.ANKI_CONNECT_URL || "http://127.0.0.1:8766";

const options = process.argv.slice(2);
const mode = options.find((a) => ["--snapshot", "--check", "--push"].includes(a));
const dirFlag = options.indexOf("--dir");
const usage = "Usage: node template-push.mjs --snapshot | --check | --push [--dir NAME]";
if (!mode) throw new Error(usage);

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

const live = async () => {
  const templates = await invoke("modelTemplates", { modelName: MODEL_NAME });
  if (!templates[TEMPLATE_NAME]) throw new Error(`模板 "${TEMPLATE_NAME}" 不存在，实际: ${Object.keys(templates)}`);
  const css = await invoke("modelStyling", { modelName: MODEL_NAME });
  return { Front: templates[TEMPLATE_NAME].Front, Back: templates[TEMPLATE_NAME].Back, css: css.css };
};

const readLocal = () => ({
  Front: fs.readFileSync(path.join(TEMPLATES, FILES.Front), "utf8"),
  Back: fs.readFileSync(path.join(TEMPLATES, FILES.Back), "utf8"),
  css: fs.readFileSync(path.join(TEMPLATES, FILES.css), "utf8"),
});

/** git HEAD = the last reviewed state; the guard must not use the local working copy. */
const committed = (name) => execFileSync("git", ["-C", REPO, "show", `HEAD:templates/微语境闪卡-1.0/${name}`],
  { encoding: "utf8" });

const current = await live();

if (mode === "--snapshot") {
  const stamp = dirFlag >= 0 ? options[dirFlag + 1]
    : `改前-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const target = path.join(TEMPLATES, stamp);
  fs.mkdirSync(target, { recursive: true });
  for (const [key, name] of Object.entries(FILES)) fs.writeFileSync(path.join(target, name), current[key]);
  console.log(`已快照集合中的模板到 ${target}`);
  for (const [key, name] of Object.entries(FILES)) {
    console.log(`  ${name}: ${Buffer.byteLength(current[key])} 字节 ${current[key] === readLocal()[key] ? "（与本地一致）" : "（与本地不同）"}`);
  }
  process.exit(0);
}

const local = readLocal();
if (mode === "--check") {
  for (const key of Object.keys(FILES)) {
    console.log(`${key}: ${current[key] === local[key] ? "一致" : "不一致（本地未推送或集合被改过）"}`);
  }
  process.exit(0);
}

for (const key of Object.keys(FILES)) {
  if (current[key] !== committed(FILES[key])) {
    throw new Error(`集合里的 ${key} 与 git HEAD 不一致：可能有人在 Anki 里直接改过模板。先 --snapshot 落盘对比，别直接覆盖。`);
  }
}
await invoke("updateModelTemplates", {
  model: { name: MODEL_NAME, templates: { [TEMPLATE_NAME]: { Front: local.Front, Back: local.Back } } },
});
await invoke("updateModelStyling", { model: { name: MODEL_NAME, css: local.css } });

const after = await live();
let ok = true;
for (const key of Object.keys(FILES)) {
  const equal = after[key] === local[key];
  ok = ok && equal;
  console.log(`${key} == 本地文件: ${equal} (${Buffer.byteLength(after[key])} 字节)`);
}
if (!ok) throw new Error("读回与本地文件不一致：Anki 侧被改动或推送未生效，先别继续");
console.log("模板与 CSS 已推送并逐字节读回一致（未触碰任何笔记）");
