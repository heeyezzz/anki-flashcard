import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readDotEnvValue = async ({ envFile, variableName }) => {
  try {
    const source = await readFile(envFile || resolve(skillRoot, ".env"), "utf8");
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(new RegExp(`^(?:export\\s+)?${variableName}=([\\s\\S]*)$`));
      if (!match) continue;
      const value = match[1].trim().replace(/^(["'])(.*)\1$/, "$2");
      if (value) return value;
    }
  } catch (_) {
    // A local .env is optional. Do not expose its path or contents.
  }
  return "";
};

export const getMiniMaxApiKey = async ({ apiKeyEnv = "MINIMAX_API_KEY", keychainService = "anki-minimax-tts", envFile = "" } = {}) => {
  if (process.env[apiKeyEnv]) return process.env[apiKeyEnv];
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a", process.env.USER || "",
      "-s", keychainService,
      "-w"
    ], { encoding: "utf8" });
    const key = stdout.trim();
    if (key) return key;
  } catch (_) {
    // Keychain is unavailable on non-macOS systems or may not contain this item.
  }
  const key = await readDotEnvValue({ envFile, variableName: apiKeyEnv });
  if (key) return key;
  throw new Error(`MiniMax TTS requires $${apiKeyEnv}, a macOS Keychain item named ${keychainService}, or a local .env file.`);
};
