---
name: yui-install
description: Use when setting up a fresh YUI checkout — install, first run, or wiring the app to a chat backend / VRM / TTS / STT. Triggers on "install", "setup", "설치", "セットアップ", or a clone that has never run.
---

# YUI install

Walk a fresh clone from `git clone` to a running desktop pet. The only hard requirement is one VRM model, and a default ships in the repo; chat backend, broker, TTS and STT are optional and can be wired now or later from the in-app panel (Settings → Advanced). Ask the user only for what the machine cannot tell you. Every step ends on a checkable state; do not report done before step 5 passes.

## 1. Prerequisites

Run `pnpm -v`, `rustc -V`, `cargo -V`. Any missing → stop and hand the user the two links (pnpm: https://pnpm.io/installation, Rust + Tauri v2: https://v2.tauri.app/start/prerequisites/). Done when all three print a version.

## 2. Dependencies

`pnpm install`. Done when it exits 0.

## 3. VRM model

The only hard requirement, and it ships: `configs/avatar.json` → `vrm_url` names `/vrms/Sendagaya_Shino.vrm`, tracked in git under `resources/vrms/`. Done when `test -f resources/vrms/Sendagaya_Shino.vrm` passes (a checkout that lost it: `git checkout -- resources/vrms/`).

Bring-your-own is optional and the user can do it later from the panel's VRM section in the Tauri app (OS picker, copied into app data). Only if they hand you a VRM 1.0 file now: copy it into `resources/vrms/`, set `vrm_url` to `/vrms/<file>.vrm`, and add `{ "id": "<stem>", "label": "<Name>", "url": "/vrms/<file>.vrm", "source": "bundled" }` to `available` in `configs/avatar.json` — `id` must match `[A-Za-z0-9._-]`, so slugify the stem.

## 4. Wiring (optional)

Ask once: "Do you want to connect a chat backend / TTS / STT now, or skip and set them later in Settings → Advanced?" Skip → go to step 5. Otherwise collect what they have. Every URL must start with `http://` or `https://` — the config validator rejects anything else at boot, which shows as an empty transparent window.

| Value | Where it goes |
|---|---|
| Chat endpoint base URL, model id | `configs/endpoints.json` → `chat_base_url` — the API root including `/v1` in both modes (e.g. `http://localhost:8643/v1`); the client appends `/chat/completions` or `/responses` itself — and `chat_model` |
| Chat API key | `.env.local` → `VITE_YUI_CHAT_KEY` (empty if the endpoint takes none) |
| Expression broker MCP URL | `broker_base_url` (e.g. `http://localhost:3201/mcp`) — published in both modes; a backend agent reads it back in Responses mode |
| TTS URL / model / speaker (+ key) | `tts_base_url` **without** `/v1` (e.g. `http://localhost:8088`) / `tts_model` / `tts_speaker`, `.env.local` → `VITE_YUI_TTS_KEY` |
| STT URL (+ key) | `stt_base_url` **with** `/v1` (e.g. `http://localhost:5517/v1`), `.env.local` → `VITE_YUI_STT_KEY` |

Then:

- `.env.local`: `cp -n .env.example .env.local`, then set only the keys the user gave.
- `configs/endpoints.json`: merge the answered keys into the existing JSON; leave the rest unset — an unset URL just keeps that feature off. Keep `chat_api: "chat_completions"` unless the backend speaks the Responses API; then set `"chat_api": "responses"` and `broker_base_url`.

Done when `node -e 'const c=JSON.parse(require("fs").readFileSync("configs/endpoints.json","utf8"));for(const k of Object.keys(c).filter(k=>k.endsWith("_url")))if(c[k]!==""&&!/^https?:\/\//.test(c[k]))process.exit(1)'` exits 0 and every value the user gave is present. Full key reference and the external services (Hermes, broker, Irodori TTS): `docs/guide/getting-started.md`.

## 5. Verify

`pnpm build` must exit 0. Then tell the user to run `pnpm tauri dev` themselves (first run compiles Rust for several minutes and opens the transparent pet window). With no backend wired the character still appears and idles; chat answers with an inline "Backend not configured" pointer until Settings → Advanced is filled. macOS grants (Screen Recording for screenshot context) are in `docs/guide/getting-started.md` § Platform Notes.

Report: what was written (paths only, never a key value), what was skipped, and the launch command.
