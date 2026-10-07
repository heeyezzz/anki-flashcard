#!/usr/bin/env node
/**
 * anki-flashcard — render a real card offline, then screenshot it.
 *
 * Anki 26 renders cards in QtWebEngine (Chromium), so headless Chrome is a faithful proxy. This
 * resolves the mustache subset the templates use against **live field values pulled from Anki**
 * (a stale field snapshot silently drops the 【…】 markers and the whole gloss annotation goes
 * unverified — that mistake already cost a round), then paints the card.
 *
 * Widths below 500px are rendered inside an iframe: Chrome clamps --window-size to 500 CSS px and
 * crops, which looks exactly like a real overflow bug.
 *
 * usage: node render-card.mjs --word WORD [--side front|back|both] [--widths 1440,560,390]
 *                            [--out DIR] [--deck NAME] [--no-shot]
 * env:   ANKI_CONNECT_URL (default http://127.0.0.1:8766), CHROME_PATH
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, "..", "templates", "微语境闪卡-1.0");
const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MODEL_NAME = process.env.ANKI_FLASHCARD_MODEL || "微语境闪卡 1.0";
const usage = "Usage: node render-card.mjs --word WORD [--side front|back|both] [--widths 1440,560,390] [--out DIR]";
const options = process.argv.slice(2);
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
const config = {
  word: "",
  side: "both",
  widths: "1440,560,390,320",
  out: "/tmp/anki-render",
  deck: "all in one::微语境闪卡",
  apiUrl: process.env.ANKI_CONNECT_URL || "http://127.0.0.1:8766",
  shot: true,
};
if (isCli) {
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--no-shot") {
      config.shot = false;
      continue;
    }
    const value = options[index + 1];
    if (!value || value.startsWith("--")) throw new Error(usage);
    if (option === "--word") config.word = value;
    else if (option === "--side") config.side = value;
    else if (option === "--widths") config.widths = value;
    else if (option === "--out") config.out = value;
    else if (option === "--deck") config.deck = value;
    else if (option === "--anki-connect-url") config.apiUrl = value;
    else throw new Error(usage);
    index += 1;
  }
  if (!config.word) throw new Error(usage);
}

const invoke = async (action, params = {}) => {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`AnkiConnect ${action}: ${payload.error}`);
  return payload.result;
};

/** Live field values for one note, straight from the collection. */
const liveFields = async (word) => {
  const notes = await invoke("findNotes", {
    query: `deck:"${config.deck}" note:"${MODEL_NAME}" "${word}"`,
  });
  if (!notes.length) throw new Error(`集合里找不到 "${word}"（deck=${config.deck}）`);
  const [info] = await invoke("notesInfo", { notes });
  const fields = {};
  for (const [name, detail] of Object.entries(info.fields)) fields[name] = detail.value;
  if (fields.Word.trim().toLowerCase() !== word.toLowerCase()) {
    throw new Error(`findNotes 命中的是 "${fields.Word}"，不是 ${word}：查询太宽`);
  }
  return fields;
};

// 分组 1 必须是 [\s\S]*?：用 (.*?) 时点号不跨行，正则会把匹配起点往后挪，
// 于是第一个 {{#…}} 之前的整段头部被静默丢掉（症状：.mctx-card 消失、模板脚本提前 return）。
const SECTION = /([\s\S]*?)\{\{([#^])([\w:]+)\}\}([\s\S]*?)\{\{\/\3\}\}([\s\S]*)/;
const VARIABLE = /\{\{([\w:]+)\}\}/g;

/** Mustache subset used by these templates: {{Field}}, {{text:Field}}, {{#Field}} / {{^Field}}. */
export const resolve = (template, fields) => {
  let out = template;
  let previous;
  do {
    previous = out;
    const match = SECTION.exec(out);
    if (!match) continue;
    const value = String(fields[match[3].split(":").pop()] ?? "").trim();
    const body = (match[2] === "#") === Boolean(value) ? match[4] : "";
    out = match[1] + body + match[5];
  } while (out !== previous);
  out = out.replace(VARIABLE, (_, name) => String(fields[name.split(":").pop()] ?? ""));
  if (out.includes("{{")) throw new Error("模板里还有未解析的 mustache 变量");
  return out;
};

const page = (side, fields) => {
  const css = fs.readFileSync(path.join(TEMPLATES, "style.css"), "utf8");
  const html = resolve(fs.readFileSync(path.join(TEMPLATES, `${side}.html`), "utf8"), fields);
  // 结构断言：头部被解析器吃掉时，模板脚本会静默提前 return，截图看着像"样式坏了"。
  if (!html.includes('class="mctx-card')) throw new Error(`${side}: 渲染结果里没有 .mctx-card，模板头部被解析丢了`);
  if (!html.includes(`>${fields.Word}</span>`)) throw new Error(`${side}: 词头 ${fields.Word} 没有出现在渲染结果里`);
  return `<html><head><meta charset="utf-8"><style>${css}</style></head><body class="card">${html}</body></html>`;
};

const slug = (word) => word.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Chrome writes the PNG and often never exits: poll for the file, then kill the throwaway profile. */
const shot = async (file, png, width, height = 2400) => {
  const profile = path.join(config.out, "profile");
  if (fs.existsSync(png)) fs.rmSync(png);
  const child = spawn(CHROME, [
    "--headless=new", `--user-data-dir=${profile}`, "--hide-scrollbars",
    `--window-size=${width},${height}`, `--screenshot=${png}`, `file://${file}`,
  ], { stdio: "ignore" });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(png) && fs.statSync(png).size > 1000) {
      await new Promise((r) => setTimeout(r, 400));
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill("SIGKILL");
  try {
    execFileSync("pkill", ["-f", profile], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
  return fs.existsSync(png) && fs.statSync(png).size > 1000;
};

/** One page stacking every width at its true viewport, so media queries evaluate correctly. */
const sheetPage = (file, widths) => {
  const rows = widths.map((w) => `<div class="cap">${w}px</div>`
    + `<iframe src="file://${file}" width="${w}" height="2400" scrolling="no"></iframe>`).join("");
  const sheet = path.join(config.out, `${path.basename(file, ".html")}-sheet.html`);
  fs.writeFileSync(sheet, "<html><head><meta charset='utf-8'><style>"
    + "body{background:#f0f;margin:0;padding:0 20px 60px;font:14px system-ui}"
    + ".cap{color:#fff;font-weight:700;padding:6px 0}"
    + "iframe{border:0;background:#fff;display:block}"
    + `</style></head><body>${rows}</body></html>`);
  return { file: sheet, width: Math.max(...widths) + 60, height: 2400 * widths.length };
};

export const TEMPLATES_DIR = TEMPLATES;
export const CHROME_PATH = CHROME;
export { page, shot };

if (isCli) {
  const fields = await liveFields(config.word);
  fs.mkdirSync(config.out, { recursive: true });
  const sides = config.side === "both" ? ["front", "back"] : [config.side];
  for (const side of sides) {
    const file = path.join(config.out, `${slug(fields.Word)}-${side}.html`);
    fs.writeFileSync(file, page(side, fields));
    console.log(`${fields.Word} ${side} 页面: ${file}`);
    if (!config.shot) continue;
    const widths = config.widths.split(",").map(Number).filter(Boolean);
    const wide = widths.filter((w) => w >= 500);
    const narrow = widths.filter((w) => w < 500);
    for (const width of wide) {
      const png = path.join(config.out, `${slug(fields.Word)}-${side}-${width}.png`);
      console.log(`  @${width}px -> ${await shot(file, png, width) ? png : "截图失败"}`);
    }
    if (narrow.length) {
      const sheet = sheetPage(file, narrow);
      const png = path.join(config.out, `${slug(fields.Word)}-${side}-narrow.png`);
      console.log(`  @${narrow.join(",")}px (iframe) -> ${await shot(sheet.file, png, sheet.width, sheet.height) ? png : "截图失败"}`);
    }
  }
}
