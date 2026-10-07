#!/usr/bin/env node
/**
 * anki-flashcard — template invariants that need no Anki and no network.
 *
 * Three checks, all of them things this deck has actually gotten wrong:
 *   1. shared helpers (mctxPattern / bindPlaying / text) must stay byte-identical between
 *      Front.html and Back.html — Anki gives templates no import mechanism, so they are copied,
 *      and a copy silently drifts;
 *   2. every class in style.css must still be used by a template — a dead rule is how the
 *      "speaker button right alignment" got implemented twice, once in a class nobody used;
 *   3. only one clip may sound at a time: play/pause are stubbed and every speaker is clicked in
 *      sequence, asserting at most one element is ever sounding.
 *
 * usage: node tests/template-invariants.mjs
 * env:   CHROME_PATH
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { page, TEMPLATES_DIR } from "../scripts/render-card.mjs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const read = (name) => fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");
const front = read("Front.html");
const back = read("Back.html");
const css = read("style.css");
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

/** The `const NAME = …;` source, so a comment tweak cannot pass as a code change. */
const sourceOf = (html, name) => {
  const match = html.match(new RegExp(`  const ${name} = (?:\\([^)]*\\)|async [^=]*)\\s*=>[\\s\\S]*?\\n  \\};`));
  return match ? match[0].replace(/\s+$/, "") : null;
};

for (const name of ["mctxPattern", "bindPlaying", "text"]) {
  const a = sourceOf(front, name);
  const b = sourceOf(back, name);
  check(`正背面共用函数一致: ${name}`, Boolean(a) && a === b,
    a === null || b === null ? "有一边找不到该函数定义" : `${a.length} 字符`);
}

const ANKI_INJECTED = new Set(["nightMode", "card", "cardTemplate", "mid", "tid", "day", "night"]);
const used = new Set([...front.matchAll(/[\w-]+/g)].map((m) => m[0]));
[...back.matchAll(/[\w-]+/g)].forEach((m) => used.add(m[0]));
const declared = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
const dead = [...declared].filter((name) => !used.has(name) && !ANKI_INJECTED.has(name));
check("style.css 没有模板里已不存在的类", dead.length === 0, dead.join("、"));

/** A note that exercises every slot shape: 3 contexts, one without audio, markers present. */
const FIXTURE = {
  Word: "invariant",
  IPA: "/ɪnˈvɛəriənt/",
  ChineseCore: "n. 不变量，恒等式 / adj. 不变的",
  Theme: "bauhaus",
  OtherMeanings: "",
  WordAudio: "fixture-word.mp3",
  SentenceCN1: "这是【不变量】。", Meaning1: "不变量", Analysis1: "a program invariant：程序不变量",
  SentenceCN2: "它保持【不变】。", Meaning2: "不变的", Analysis2: "stay invariant：保持不变",
  SentenceCN3: "列出【不变量】清单。", Meaning3: "恒等式", Analysis3: "list invariants：列出恒等式",
  Sentence1: "This is an invariant.", AudioSentence1: "fixture-1.mp3",
  Sentence2: "It stays invariant.", AudioSentence2: "",
  Sentence3: "List the invariants.", AudioSentence3: "fixture-3.mp3",
};

const PROBE = `<script>
window.__errs = [];
window.addEventListener("error", (e) => window.__errs.push(String(e.message).slice(0, 120)));
</script><script>
(() => {
  const active = new Set();
  let overlaps = 0;
  const nativePause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play = function () {
    if (active.size > 0 && !active.has(this)) overlaps += 1;
    active.add(this);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {
    active.delete(this);
    return nativePause.apply(this, arguments);
  };
  document.addEventListener("DOMContentLoaded", () => {
    const rows = [...document.querySelectorAll(".mctx-audio-btn--other")].filter((b) => !b.hidden);
    const word = document.getElementById("mctx-play-word");
    const worst = [];
    [...rows, word, ...rows].filter(Boolean).forEach((button) => {
      button.click();
      if (active.size > 1) worst.push(active.size);
    });
    fetch("/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buttons: rows.length,
        overlaps,
        worst,
        sounding: active.size,
        diag: {
          slots: document.querySelectorAll(".mctx-slot").length,
          filled: [...document.querySelectorAll(".mctx-slot")].filter((s) => !s.hidden).length,
          allBtns: document.querySelectorAll(".mctx-audio-btn").length,
          hiddenBtns: [...document.querySelectorAll(".mctx-audio-btn")].filter((b) => b.hidden).length,
          script: document.querySelectorAll("script").length,
        },
        errs: window.__errs,
      }),
    });
  });
})();
</script>`;

const runProbe = (side) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/verdict") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => { res.writeHead(204).end(); server.close(); resolve(JSON.parse(body)); });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(side, FIXTURE).replace("</head>", `${PROBE}</head>`));
  });
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    const profile = fs.mkdtempSync("/tmp/anki-invariants-");
    const child = spawn(CHROME, ["--headless=new", `--user-data-dir=${profile}`, "--mute-audio",
      "--autoplay-policy=no-user-gesture-required", "--window-size=560,900",
      `http://127.0.0.1:${port}/card.html`], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      server.close();
      resolve({ error: "60 秒内没有收到裁决：Chrome 可能没起来，检查 CHROME_PATH" });
    }, 60_000);
    child.on("exit", () => clearTimeout(timer));
  });
});

for (const side of ["front", "back"]) {
  const result = await runProbe(side);
  check(`${side === "front" ? "正面" : "背面"}：每次点击后同时在响的音频 ≤ 1`,
    !result.error && result.overlaps === 0 && result.worst.length === 0,
    result.error || JSON.stringify(result));
  check(`${side === "front" ? "正面" : "背面"}：例句喇叭确实被挂上了（不是空跑）`,
    (result.buttons || 0) >= 2, `buttons=${result.buttons}`);
}

if (failures.length) {
  console.log(`\n模板不变量失败 ${failures.length} 项`);
  process.exit(1);
}
console.log("\n模板不变量全部通过");
