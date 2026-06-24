#!/usr/bin/env node
// 대화형 초기 설정 — clone 직후 endpoints.json / .env.local 을 채우고 prereq·VRM 을 점검한다.
// 외부 서비스(Hermes·broker·TTS·STT)는 별도 레포라 설치하지 않고 링크만 안내한다.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

// --- pure helpers (tested) ---

// 빈 문자열·undefined 는 "기존값 유지". existing 은 변형하지 않는다.
export function mergeEndpoints(existing, overrides) {
  const out = { ...existing };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

// provider 별로 채워야 할 키가 다르다. none 이면 아무것도 건드리지 않는다.
export function ttsOverrides(provider, { baseUrl, voice, speaker } = {}) {
  if (provider === "irodori")
    return {
      tts_provider: "irodori",
      irodori_base_url: baseUrl,
      irodori_speaker: speaker ?? voice,
      tts_voice: voice,
    };
  if (provider === "openai")
    return { tts_provider: "openai", tts_base_url: baseUrl, tts_voice: voice };
  return {};
}

// openai TTS만 Bearer 키가 필요하다. irodori 는 self-serving 이라 키를 묻지 않는다.
export function ttsNeedsKey(provider) {
  return provider === "openai";
}

// .env 내용에서 key 한 줄만 갱신/추가. 빈 값이면 원본 그대로 둔다. 다른 줄은 보존.
export function setEnvVar(env, key, value) {
  if (value === "" || value === undefined) return env;
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) return env.replace(re, line);
  return env.endsWith("\n") || env === "" ? `${env}${line}\n` : `${env}\n${line}\n`;
}

// --- interactive shell (untested) ---

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function have(cmd, args = ["--version"]) {
  try {
    return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function checkPrereqs() {
  const checks = [
    ["pnpm", have("pnpm")],
    ["rustc", have("rustc")],
    ["cargo", have("cargo")],
  ];
  console.log("\nPrerequisites:");
  for (const [name, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (checks.some(([, ok]) => !ok))
    console.log("  → missing tools: see https://v2.tauri.app/start/prerequisites/");
}

function checkVrm() {
  const dir = join(root, "resources", "vrms");
  const models = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".vrm")) : [];
  if (models.length) console.log(`\n✓ VRM model(s): ${models.join(", ")}`);
  else console.log("\n✗ No VRM in resources/vrms/ — drop a VRM 1.0 *.vrm there before running.");
}

async function main() {
  // async-iterator pull (not rl.question) — buffers lines, so piped input is read correctly too.
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (label, current) => {
    process.stdout.write(`${label}${current ? ` [${current}]` : ""}: `);
    const { value, done } = await lines.next();
    return done ? "" : value.trim();
  };

  console.log("YUI setup — blank answer keeps the current value.");
  checkPrereqs();
  checkVrm();

  const cfgPath = join(root, "configs", "endpoints.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));

  // Required (docs/setup.md "Required vs Optional"): chat backend + chat auth key + broker.
  console.log("\n=== REQUIRED ===");
  console.log("— Backend agent (chat) —");
  const chat = {
    chat_base_url: await ask("chat_base_url", cfg.chat_base_url),
    chat_model: await ask("chat_model", cfg.chat_model),
  };
  console.log("— Chat auth key (.env.local) —");
  const key = await ask("VITE_YUI_CHAT_KEY", "");
  console.log("— Expression broker —");
  const broker = { broker_base_url: await ask("broker_base_url", cfg.broker_base_url) };

  // Optional: TTS, STT. Blank / "none" to skip.
  console.log("\n=== OPTIONAL ===");
  console.log("— TTS (optional) — provider: irodori / openai / none");
  console.log("  (voice/reference is set by you afterward — not asked here)");
  const provider = (await ask("tts_provider", cfg.tts_provider)) || cfg.tts_provider;
  let tts = {};
  if (provider === "irodori")
    tts = ttsOverrides("irodori", { baseUrl: await ask("irodori_base_url", cfg.irodori_base_url) });
  else if (provider === "openai")
    tts = ttsOverrides("openai", { baseUrl: await ask("tts_base_url", cfg.tts_base_url) });
  // irodori 는 self-serving — 키를 묻지 않는다.
  const ttsKey = ttsNeedsKey(provider) ? await ask("VITE_YUI_TTS_KEY", "") : "";
  console.log("— STT (optional) —");
  const stt = { stt_base_url: await ask("stt_base_url", cfg.stt_base_url) };
  const sttKey = await ask("VITE_YUI_STT_KEY", "");

  const merged = mergeEndpoints(cfg, { ...chat, ...broker, ...tts, ...stt });
  writeFileSync(cfgPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`\n✓ wrote ${cfgPath.replace(`${root}/`, "")}`);

  const envPath = join(root, ".env.local");
  const seed = existsSync(envPath)
    ? readFileSync(envPath, "utf8")
    : readFileSync(join(root, ".env.example"), "utf8");
  let env = setEnvVar(seed, "VITE_YUI_CHAT_KEY", key);
  env = setEnvVar(env, "VITE_YUI_STT_KEY", sttKey);
  env = setEnvVar(env, "VITE_YUI_TTS_KEY", ttsKey);
  writeFileSync(envPath, env);
  console.log("✓ wrote .env.local");

  rl.close();

  console.log("\nNext:");
  console.log("  pnpm install && pnpm tauri dev");
  console.log("  External services (separate repos) — see docs/setup.md");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
