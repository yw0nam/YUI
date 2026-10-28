#!/usr/bin/env node
// PROTOTYPE #1661 driver: one fresh pet page (fresh storage, fresh chat id) per trial against the
// push gateway; records every push frame of the trial's turn and prints one JSON line per trial.
//   node drive.mjs --label A-default --wording A --prompt a --n 5 --port 18661 --key k --out file.jsonl
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(
  "/Users/nam-young-woo/Desktop/codes/waifu/2026/YUI/.claude/skills/yui-runtime-evidence/package.json",
);
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const opt = (n, d) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d);
const PROMPTS = {
  a: "What's the weather in Seoul for the next 3 days in metric?",
  b: "Show me a snapshot card.",
  c: "Tell me a short fun fact about octopuses.",
  d: "What's the weather in Seoul for the next 10 days?",
  e: 'Skip plugin_describe and call plugin_call for weather_lookup right away with the arguments {"city": "Seoul", "days": 3}. Then tell me the forecast.',
};
const prompt = PROMPTS[opt("prompt")];
const n = Number(opt("n", 5));
const port = opt("port");
const key = opt("key");
const out = opt("out");
const label = opt("label");
const wording = opt("wording", "A");

const seed = {
  "yui.endpoints": { chat_base_url: `http://127.0.0.1:${port}`, chat_api: "push", chat_model: "" },
  "yui.chat-key": { apiKey: key },
  "yui.locale": "en",
  "yui.schedule": { enabled: false, entries: [] },
  "yui.filler": { enabled: false, language: "en", customPools: {} },
  "yui.proactive": { enabled: false },
  "yui.proto-bridge-wording": wording,
  "yui.proto-bridge-error": opt("error", "schema"),
};

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
for (let i = 0; i < n; i++) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 600 } });
  await ctx.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, JSON.stringify(v));
  }, seed);
  const page = await ctx.newPage();
  const frames = [];
  let ready;
  const readyP = new Promise((r) => (ready = r));
  let ended;
  const endP = new Promise((r) => (ended = r));
  let myTurn = null;
  const t0 = Date.now();
  page.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      const f = JSON.parse(payload);
      if (f.type === "turn" && f.text === prompt) {
        myTurn = f.turn_id;
        frames.push({ dir: "out", t: Date.now() - t0, type: "turn", context: f.client_context });
      } else if (f.type === "tool_result") {
        frames.push({ dir: "out", t: Date.now() - t0, type: "tool_result", id: f.id, result: f.result, images: f.images?.length ?? 0 });
      } else if (f.type === "hello") {
        frames.push({ dir: "out", type: "hello", chat_id: f.chat_id, tools: f.tools.map((t) => t.function.name), defs: f.tools.filter((t) => t.function.name.startsWith("plugin_")) });
      }
    });
    ws.on("framereceived", ({ payload }) => {
      const f = JSON.parse(payload);
      if (f.type === "ready") ready();
      if (myTurn === null || f.turn_id !== myTurn) return;
      if (f.type === "tool_call") frames.push({ dir: "in", t: Date.now() - t0, type: "tool_call", id: f.id, name: f.name, arguments: f.arguments });
      else if (f.type === "render" || f.type === "speech")
        frames.push({ dir: "in", t: Date.now() - t0, type: f.type, speech: f.segments.map((s) => s.speech ?? "").join(" ") });
      else if (f.type === "error") frames.push({ dir: "in", type: "error", message: f.message });
      else if (f.type === "tool_status") frames.push({ dir: "in", type: "tool_status", tool_id: f.tool_id, state: f.state });
      else if (f.type === "turn_end") {
        frames.push({ dir: "in", t: Date.now() - t0, type: "turn_end" });
        ended();
      }
    });
  });
  await page.goto("http://127.0.0.1:1461/index.html");
  await Promise.race([readyP, new Promise((r) => setTimeout(r, 30000))]);
  await page.waitForTimeout(2500);
  await page.evaluate((p) => window.__yui_send(p), prompt);
  const finished = await Promise.race([endP.then(() => true), new Promise((r) => setTimeout(() => r(false), 180000))]);
  const chat_id = frames.find((f) => f.type === "hello")?.chat_id;
  const record = { chat_id, label, wording, prompt: opt("prompt"), trial: i + 1, finished, frames };
  fs.appendFileSync(out, `${JSON.stringify(record)}\n`);
  const calls = frames.filter((f) => f.type === "tool_call").map((f) => f.name);
  console.log(JSON.stringify({ label, trial: i + 1, finished, calls }));
  await ctx.close();
}
await browser.close();
process.exit(0);
