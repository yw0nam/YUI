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

// TTS 서버 주소·모델명·기본 화자 id. 빈 답은 mergeEndpoints 가 "기존값 유지" 로 처리한다.
export function ttsOverrides({ baseUrl, model, speaker } = {}) {
  return { tts_base_url: baseUrl, tts_model: model, tts_speaker: speaker };
}

// --no-install 이면 마지막 pnpm install 을 건너뛴다.
export function shouldInstall(argv) {
  return !argv.includes("--no-install");
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

// 누락된 도구 이름 목록을 돌려준다. 호출측이 fail-fast 를 결정한다.
export function checkPrereqs(haveCmd = have) {
  const checks = [
    ["pnpm", haveCmd("pnpm")],
    ["rustc", haveCmd("rustc")],
    ["cargo", haveCmd("cargo")],
  ];
  console.log("\nPrerequisites:");
  for (const [name, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) {
    console.log("  → missing tools: see https://v2.tauri.app/start/prerequisites/");
    if (missing.includes("rustc") || missing.includes("cargo"))
      console.log("  → install Rust: https://rustup.rs/");
  }
  return missing;
}

function checkVrm() {
  const dir = join(root, "resources", "vrms");
  const models = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".vrm")) : [];
  if (models.length) console.log(`\n✓ VRM model(s): ${models.join(", ")}`);
  else {
    // ponytail: guidance only — no bundle/auto-download; VRM licenses vary per model.
    console.log("\n✗ No VRM in resources/vrms/ — drop a VRM 1.0 *.vrm there before running.");
    console.log("  → samples: https://github.com/madjin/vrm-samples");
    console.log("  → recommended: download a model you like from https://hub.vroid.com/en");
    console.log("  (check each model's license before use)");
  }
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
  if (checkPrereqs().length) process.exit(1);
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
  console.log("— TTS (optional) — OpenAI-compatible /v1/audio/speech —");
  console.log("  (tts_model must match the server's configured name; tts_speaker is the default");
  console.log("   voice id, and the panel can pick another later)");
  const tts = ttsOverrides({
    baseUrl: await ask("tts_base_url", cfg.tts_base_url),
    model: await ask("tts_model", cfg.tts_model),
    speaker: await ask("tts_speaker", cfg.tts_speaker),
  });
  // 키를 요구하지 않는 서버도 있으니 비워둘 수 있다.
  const ttsKey = await ask("VITE_YUI_TTS_KEY", "");
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

  const install = shouldInstall(process.argv);
  if (install) {
    console.log("\nRunning pnpm install…");
    const r = spawnSync("pnpm", ["install"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  console.log("\nNext:");
  console.log(`  ${install ? "" : "pnpm install && "}pnpm tauri dev`);
  console.log("  External services (separate repos) — see docs/setup.md");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
