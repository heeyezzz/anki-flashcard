#!/usr/bin/env node
/**
 * anki-flashcard — the Anki app around a card run: bring it up, sync, and close it again.
 *
 *   --start    before anything touches Anki: launch Anki when the endpoint is dead, then sync so the
 *              run starts from the latest collection.
 *   --finish   only after the write AND verify-import.mjs passed: sync again, then quit Anki.
 *
 * --finish refuses to quit on a failed sync: a sync that needs fixing is fixed with Anki still open,
 * not hidden behind a closed window. macOS only (open / osascript).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DEFAULT_API_URL = "http://127.0.0.1:8766";
const APP_NAME = process.env.ANKI_APP || "Anki";
// Agent Connect reports its terminal state as `done`; upstream AnkiConnect builds use `idle`.
const TERMINAL_STATES = new Set(["done", "idle"]);
const SYNC_WAIT_MS = 600_000;

const usage = "Usage: node anki-session.mjs --start | --finish [--anki-connect-url URL] [--timeout SECONDS]";
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let mode = "";
let configuredApiUrl = process.env.ANKI_CONNECT_URL || DEFAULT_API_URL;
let onlineTimeout = 90;
const options = process.argv.slice(2);
for (let index = 0; index < options.length; index += 1) {
  const option = options[index];
  const nextValue = (label) => {
    const value = options[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${usage}\n${label} requires a value.`);
    index += 1;
    return value;
  };
  if (option === "--start" || option === "--finish") {
    assert(!mode, `${usage}\nChoose one of --start / --finish.`);
    mode = option.slice(2);
  } else if (option === "--anki-connect-url") {
    configuredApiUrl = nextValue("--anki-connect-url");
  } else if (option === "--timeout") {
    const value = Number(nextValue("--timeout"));
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${usage}\n--timeout requires a positive number of seconds.`);
    onlineTimeout = value;
  } else {
    throw new Error(usage);
  }
}
assert(mode, `${usage}\n--start or --finish is required.`);
// Launching and quitting the app is macOS-specific here (open / osascript); elsewhere Anki is opened
// and closed by hand, and the sync half still works.
assert(process.platform === "darwin", `自动开关 Anki 只在 macOS 上实现，当前系统：${process.platform}。请手动打开/退出 Anki。`);
// The name goes into an AppleScript string, so keep it free of quotes and escapes.
assert(/^[A-Za-z0-9 ._-]+$/.test(APP_NAME), `ANKI_APP must be a plain app name (letters, digits, space, dot, hyphen, underscore): ${APP_NAME}`);

let apiUrl;
try {
  apiUrl = new URL(configuredApiUrl).toString().replace(/\/$/, "");
} catch (_) {
  throw new Error(`Invalid AnkiConnect URL: ${configuredApiUrl}`);
}

const post = async (body, timeoutMs) => {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}`);
  return response.json();
};

// Any JSON-RPC reply proves something is listening; whether this build answers `version` is beside the point.
const isOnline = async () => {
  try {
    const payload = await post({ action: "version", version: 6, params: {} }, 3000);
    return Boolean(payload) && typeof payload === "object" && ("result" in payload || "error" in payload);
  } catch (_) {
    return false;
  }
};

const invoke = async (action, params = {}) => {
  const payload = await post({ action, version: 6, params }, 60_000);
  if (payload.error) throw new Error(`AnkiConnect ${action}: ${payload.error}`);
  return payload.result;
};

const waitUntilOnline = async (seconds) => {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await isOnline()) return true;
    await sleep(1500);
  }
  return false;
};

const pick = (object, ...names) => {
  for (const name of names) if (object?.[name] !== undefined) return object[name];
  return undefined;
};

const launchAnki = async () => {
  try {
    await run("open", ["-a", APP_NAME]);
  } catch (error) {
    throw new Error(`启动 ${APP_NAME} 失败：${error.message}\n请手动打开 Anki，并确认它的 Agent Connect（或 AnkiConnect）接口已启用。`);
  }
};

// syncStatus answers { job: { state, error, ... }, loggedIn, mediaSyncing, required } — but the job
// fields have shown up at the top level in other builds, so read both shapes.
const jobOf = (status) => pick(status, "job") ?? status;
const stateOf = (status) => pick(jobOf(status), "state");

const startSync = async () => {
  let status;
  try {
    status = await invoke("syncStatus");
  } catch (error) {
    // Plain AnkiConnect ships no sync actions: the caller reports it and leaves syncing to the user.
    if (/unsupported|unknown action|not exist/i.test(String(error?.message))) return { supported: false };
    throw error;
  }
  // A non-terminal state here is Anki's own sync-on-open still running: wait that job out instead of
  // queueing a second one.
  if (!TERMINAL_STATES.has(stateOf(status))) return { supported: true, status };
  const started = await invoke("syncNow");
  assert(started?.started !== false, "syncNow 拒绝了这个同步任务，请在 Anki 里手动点一次同步后重试。");
  // syncNow returns as soon as the job is queued. The status above is already terminal, so reusing it
  // would read "this sync finished" seconds before the job even started: settle, then poll fresh.
  await sleep(3000);
  return { supported: true, status: null };
};

const awaitSync = async (initialStatus) => {
  let status = initialStatus;
  const deadline = Date.now() + SYNC_WAIT_MS;
  for (;;) {
    if (!status) status = await invoke("syncStatus");
    const job = jobOf(status);
    const state = pick(job, "state");
    if (TERMINAL_STATES.has(state)) {
      const loggedIn = pick(status, "loggedIn", "logged_in") ?? pick(job, "loggedIn", "logged_in");
      const mediaSyncing = (pick(status, "mediaSyncing", "media_syncing") ?? pick(job, "mediaSyncing", "media_syncing")) === true;
      const error = pick(job, "error") ?? null;
      return {
        supported: true,
        state,
        error,
        loggedIn: loggedIn ?? null,
        mediaSyncing,
        required: pick(status, "required") ?? pick(job, "required") ?? null,
        ok: !error && !mediaSyncing && loggedIn !== false
      };
    }
    if (Date.now() > deadline) throw new Error(`同步超时（${SYNC_WAIT_MS / 1000}s 未到终态），最后状态：${state ?? "未知"}`);
    await sleep(2000);
    status = await invoke("syncStatus");
  }
};

const sync = async () => {
  const started = await startSync();
  if (!started.supported) return started;
  const result = await awaitSync(started.status);
  assert(result.ok, `同步未成功：${JSON.stringify({ state: result.state, error: result.error, loggedIn: result.loggedIn, mediaSyncing: result.mediaSyncing, required: result.required })}`);
  return result;
};

const quitAnki = async () => {
  let notice = "";
  // One quit event is not enough: Anki has answered -128 and stayed up, then accepted the next
  // attempt seconds later. Re-send while the endpoint still answers, and treat the endpoint going
  // dark — not the AppleScript reply — as the proof of closure.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await run("osascript", ["-e", `tell application "${APP_NAME}" to quit`]);
    } catch (error) {
      notice = String(error.stderr || error.message).trim().split("\n").pop();
    }
    const untilRetry = Math.min(Date.now() + 12_000, deadline);
    while (Date.now() < untilRetry) {
      if (!(await isOnline())) return { closed: true, notice };
      await sleep(1500);
    }
    if (!(await isOnline())) return { closed: true, notice };
    if (Date.now() >= deadline) return { closed: false, notice };
  }
};

const report = (payload) => console.log(JSON.stringify(payload, null, 2));

if (mode === "start") {
  const alreadyOnline = await isOnline();
  if (!alreadyOnline) {
    await launchAnki();
    assert(await waitUntilOnline(onlineTimeout), `${APP_NAME} 已启动，但 ${onlineTimeout}s 内 ${apiUrl} 没有响应。请确认 Anki 里启用了 Agent Connect（或 AnkiConnect），必要时加大 --timeout。`);
  }
  const session = await sync();
  report({ mode: "start", ankiConnectUrl: apiUrl, online: true, launchedByUs: !alreadyOnline, sync: session });
  process.exit(0);
}

const session = await sync();
// Closing an Anki whose sync we could not run would hide unsynced work, so this path stops short.
assert(session.supported, `${apiUrl} 没有同步动作（原始 AnkiConnect 就是这样）：卡片已在本地，请在 Anki 里手动点一次同步，然后自己退出 Anki。`);
const closed = await quitAnki();
assert(closed.closed, `${APP_NAME} 在退出请求后 60s 仍在响应 ${apiUrl}${closed.notice ? `：${closed.notice}` : ""}。请检查 Anki 窗口是否有对话框。`);
report({ mode: "finish", ankiConnectUrl: apiUrl, sync: session, closed: true, quitNotice: closed.notice || null });
