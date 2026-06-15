# YUI — Project Structure & Stack

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | tauri 2.11.x |
| Build / dev server | Vite | 8.x (dev port `YUI_DEV_PORT`, default **1420**; auto-port launchers pick a free port per worktree) |
| Language | TypeScript | 6.x (bundler mode, `noEmit`) |
| Render | three.js | 0.180.x |
| VRM / motion | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| Voice | `@ricky0123/vad-web` (Silero+ONNX) | 0.0.x |

## Directory Map

```
YUI/
  index.html                # Vite entry
  vite.config.ts            # dev port YUI_DEV_PORT|1420, strictPort, host 127.0.0.1
  biome.json                # Format + lint config (curated rule set)
  .claude/
    hooks/                  # Workflow guards (worktree setup, main/secret guard, docs guard) — fail open
    skills/                 # Vendored skills (karpathy-guidelines)
    agents/                 # Vendored sub-agent definitions
  scripts/                  # Dev launchers (dev-port.mjs, tauri-dev.mjs, dev-auto.mjs) + worktree-setup.sh + ci/test-guard.sh
  configs/                  # Runtime-loaded config (no hardcoding)
    endpoints.json            # chat/stt/tts base urls + tts_provider + irodori_* + broker_base_url
    emotion_registry.json     # emotion id → vrm_expression + fallback
    motions.json              # motion registry
    avatar.json               # VRM avatar config
    emotion_text/             # per-provider voice-tag vocabulary (e.g. emotion_text/irodori.json)
  public/motions/           # VRMA motion assets
  motion-preview.html       # Dev motion/emotion inspector (not in Tauri window)
  src/
    dev/                    # Dev-only tooling (motion-preview.ts, motion-preview.css)
    main.ts                 # Bootstrap wiring
    contract/               # TS contract types — source of truth (types.ts, index.ts)
    renderer/               # three.js + VRM (index.ts, emotion-resolver.ts, motion-controller.ts)
    io/                     # I/O layer (chat-client.ts, tts-pipeline.ts, stt-vad.ts, os-context.ts, etc.)
    dispatcher/             # Event bus + classify→guardrail→route
    ambient/tier1.ts        # Blink / idle sway / breath (backend-independent)
    config/                 # Config load + validate + reactive store + hot-reload
    styles.css
  src-tauri/
    tauri.conf.json         # Transparent always-on-top pet window
    src/                    # Rust: lib.rs, main.rs, drag.rs, screenshot.rs, os_event_watcher/ (mod·macos·windows)
  docs/                     # Design source of truth
```
