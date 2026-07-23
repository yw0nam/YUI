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
    skills/                 # Vendored skills (karpathy-guidelines, yui-dev-workflow)
    agents/                 # Vendored sub-agent definitions
  scripts/                  # Dev launchers (dev-port.mjs, tauri-dev.mjs, dev-auto.mjs) + setup.mjs + worktree-setup.sh + ci/test-guard.sh
  configs/                  # Runtime-loaded config (no hardcoding)
    endpoints.json            # chat/stt/tts base urls + tts_provider + irodori_* + broker_base_url
    emotion_registry.json     # emotion id → vrm_expression + fallback
    motions.json              # motion registry
    motion-filter.json        # user-selected motion category deny-list (blocked_tags) hidden from the agent-facing catalog
    avatar.json               # VRM avatar config
    filler.json               # filler motion timing and pool config
    guardrails.json           # dispatcher cooldown and suppression config
    hotkeys.json              # global summon accelerator (empty = disabled)
    emotion_text/             # per-provider voice-tag vocabulary (e.g. emotion_text/irodori.json)
  public/motions/           # VRMA motion assets
  motion-preview.html       # Dev motion/emotion inspector (not in Tauri window)
  src/
    dev/                    # Dev-only tooling (motion-preview.ts, motion-preview.css)
    main.ts                 # Application entry and orchestration
    bootstrap-wiring.ts     # VRM + speaker selection bootstrap wiring
    logger.ts               # Namespaced frontend logger
    drag.ts                 # Main-window drag behavior
    settings-main.ts        # Settings-window entry
    contract/               # TS contract types — source of truth (types.ts, index.ts)
    renderer/               # three.js + VRM (index.ts, emotion-resolver.ts, motion-controller.ts)
    io/                     # I/O layer (chat-client.ts, tts-pipeline.ts, stt-vad.ts, os-context.ts, etc.)
    dispatcher/             # Event bus + classify→guardrail→route
    ambient/tier1.ts        # Blink / idle sway / breath (backend-independent)
    config/                 # Config load + validate + reactive store + hot-reload
    ui/                     # Floating surfaces and controls
      surfaces.ts             # Speech bubble, text input, and tool-status chip
      quick-controls.ts       # Quick-controls shell
      quick-controls/         # monitors-section.ts, endpoints-section.ts, popover.ts, template.ts, and selection helpers
      i18n.ts + i18n/         # UI translation runtime and locale catalogs
      markdown.ts             # Speech markdown rendering
      cue-list.ts             # Schedule/proactive cue list
      voice-input-indicator.ts # Voice-input indicator surface
      voice-input-status.ts    # Voice-input status model
      boot-error.ts           # Boot-failure notice
    styles.css
  src-tauri/
    tauri.conf.json         # Transparent always-on-top pet window
    src/                    # Rust: lib.rs, main.rs, drag.rs, screenshot.rs, agent_ingress.rs, import_fs.rs, log_rotation.rs, passthrough.rs, tray.rs, voice_import.rs, vrm_import.rs, os_event_watcher/ (mod·macos·windows)
  Mods/                     # Standalone MCP servers, independent of the app runtime (Python/uv, own `mods` CI job)
    browser-cdp/            # Browser CDP Mod
    desktop-control/        # macOS screen and app-control Mod
    shell-sandbox/          # Sandboxed shell Mod
    router/                 # Shared Mod router
    docker-compose.yml      # Container orchestration for Mods
    README.md               # Mod setup and operation
  docs/                     # Design source of truth
```
