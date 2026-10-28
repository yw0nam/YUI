globalThis.YUI_MAP =
{
  "title": "YUI client",
  "zones": [
    {
      "id": "io",
      "title": "User I/O",
      "note": "touch, screen, and voice"
    },
    {
      "id": "logic",
      "title": "Core logic",
      "note": "fires candidates and runs the turn; the backend decides what to say"
    },
    {
      "id": "outside",
      "title": "Outside communication",
      "note": "doors to the OS and network"
    },
    {
      "id": "shared",
      "title": "Shared state and wiring",
      "note": "read, mirrored, or used to connect the modules above; no lines drawn"
    }
  ],
  "modules": [
    {
      "id": "user",
      "label": "User",
      "kind": "person",
      "col": 0,
      "row": 0,
      "desc": "Types or speaks, touches and drags the character, changes settings. Sees the character and the bubble, hears the voice."
    },
    {
      "id": "senders",
      "label": "Outside senders",
      "kind": "external",
      "col": 5,
      "row": 0,
      "desc": "the factorio plugin, coding-agent hooks, signal producers, the verification driver"
    },
    {
      "id": "shell",
      "label": "Rust shell",
      "kind": "shell",
      "col": 4,
      "row": 0,
      "desc": "OS polling, loopback HTTP listener, window control, screen capture, logs",
      "zone": "outside"
    },
    {
      "id": "window",
      "label": "Window I/O",
      "kind": "module",
      "col": 1,
      "row": 0,
      "desc": "Pointer gestures, click-through, OS event seam, window geometry",
      "zone": "io"
    },
    {
      "id": "sources",
      "label": "Firing sources",
      "kind": "module",
      "col": 2,
      "row": 0,
      "desc": "Idle-tick, inbox, gesture, and wake sources that raise speech candidates",
      "zone": "logic"
    },
    {
      "id": "ambient",
      "label": "Ambient",
      "kind": "module",
      "col": 2,
      "row": 2,
      "desc": "Liveliness, locomotion, and the bed scene, independent of the backend",
      "zone": "logic"
    },
    {
      "id": "input",
      "label": "Input",
      "kind": "module",
      "col": 1,
      "row": 1,
      "desc": "Composer text and images, voice capture and STT",
      "zone": "io"
    },
    {
      "id": "dispatcher",
      "label": "Dispatcher",
      "kind": "module",
      "col": 2,
      "row": 1,
      "desc": "Event bus, tier classification, guardrails, pacer, turn gate, tier-1 reactions",
      "zone": "logic"
    },
    {
      "id": "backend-call",
      "label": "Backend call",
      "kind": "module",
      "col": 3,
      "row": 1,
      "desc": "Client context, the call on the selected transport, reply settling, turn record",
      "zone": "logic"
    },
    {
      "id": "transport",
      "label": "Transport",
      "kind": "module",
      "col": 4,
      "row": 1,
      "desc": "Request streaming loops and the push WebSocket",
      "zone": "outside"
    },
    {
      "id": "backend",
      "label": "Backend agent",
      "kind": "external",
      "col": 5,
      "row": 1,
      "desc": "Judges whether and what to speak"
    },
    {
      "id": "display",
      "label": "Display",
      "kind": "module",
      "col": 1,
      "row": 2,
      "desc": "Speech bubble, status pill, delegation chip, notices",
      "zone": "io"
    },
    {
      "id": "speech",
      "label": "Speech output",
      "kind": "module",
      "col": 1,
      "row": 3,
      "desc": "Sentence TTS, in-order playback, filler, speaker catalogue",
      "zone": "io"
    },
    {
      "id": "turn",
      "label": "Turn state and output",
      "kind": "module",
      "col": 3,
      "row": 2,
      "desc": "Turn ledger, TurnOutput and TurnFeed ports, push reply player",
      "zone": "logic"
    },
    {
      "id": "tools",
      "label": "Client tools",
      "kind": "module",
      "col": 3,
      "row": 0,
      "desc": "generate_express, body_action, look, avatar executor, vocabulary",
      "zone": "logic"
    },
    {
      "id": "voice-svc",
      "label": "Voice services",
      "kind": "external",
      "col": 5,
      "row": 3,
      "desc": "STT and TTS HTTP endpoints"
    },
    {
      "id": "renderer",
      "label": "Renderer",
      "kind": "module",
      "col": 1,
      "row": 4,
      "desc": "three.js scene, VRM, emotion, mouth, motion, camera, hit-test",
      "zone": "io"
    },
    {
      "id": "settings",
      "label": "Settings and config",
      "kind": "module",
      "col": 2,
      "row": 4,
      "desc": "Persisted settings stores, configs/*.json, quick controls, asset selection",
      "zone": "shared"
    },
    {
      "id": "conversation",
      "label": "Conversation stores",
      "kind": "module",
      "col": 3,
      "row": 4,
      "desc": "Transcript, response-id session, context history, turn-record log",
      "zone": "shared"
    },
    {
      "id": "bridge",
      "label": "Cross-window bridge",
      "kind": "module",
      "col": 4,
      "row": 4,
      "desc": "Settings signal, message-window surfaces, push state and delegation mirrors",
      "zone": "shared"
    },
    {
      "id": "wiring",
      "label": "Wiring and base",
      "kind": "module",
      "col": 5,
      "row": 4,
      "desc": "src/app and the window entries wire modules by callbacks; contract types, logger",
      "zone": "shared"
    }
  ],
  "links": [
    {
      "from": "user",
      "to": "window",
      "label": "taps, pats, drags",
      "fromPort": [
        1,
        0.06
      ],
      "toPort": [
        0,
        0.5
      ]
    },
    {
      "from": "user",
      "to": "input",
      "label": "text, images, voice",
      "fromPort": [
        1,
        0.28
      ],
      "toPort": [
        0,
        0.5
      ]
    },
    {
      "from": "display",
      "to": "user",
      "label": "bubble, status",
      "fromPort": [
        0,
        0.5
      ],
      "toPort": [
        1,
        0.5
      ]
    },
    {
      "from": "speech",
      "to": "user",
      "label": "voice",
      "fromPort": [
        0,
        0.5
      ],
      "toPort": [
        1,
        0.72
      ]
    },
    {
      "from": "renderer",
      "to": "user",
      "label": "face, mouth, motion",
      "fromPort": [
        0,
        0.5
      ],
      "toPort": [
        1,
        0.94
      ]
    },
    {
      "from": "window",
      "to": "sources",
      "label": "idle samples, gestures"
    },
    {
      "from": "input",
      "to": "dispatcher",
      "label": "user text or voice envelope"
    },
    {
      "from": "sources",
      "to": "dispatcher",
      "label": "candidate envelopes"
    },
    {
      "from": "ambient",
      "to": "dispatcher",
      "label": "avatar.* events"
    },
    {
      "from": "dispatcher",
      "to": "backend-call",
      "label": "tier-2 turn to call"
    },
    {
      "from": "backend-call",
      "to": "transport",
      "label": "request or turn frame"
    },
    {
      "from": "transport",
      "to": "backend-call",
      "label": "stream events"
    },
    {
      "from": "transport",
      "to": "backend",
      "label": "HTTP stream, WebSocket frames"
    },
    {
      "from": "backend",
      "to": "transport",
      "label": "reply frames"
    },
    {
      "from": "backend-call",
      "to": "turn",
      "label": "TurnOutput, TurnFeed"
    },
    {
      "from": "transport",
      "to": "turn",
      "label": "push reply frames"
    },
    {
      "from": "transport",
      "to": "tools",
      "label": "tool call to run"
    },
    {
      "from": "turn",
      "to": "speech",
      "label": "deltas, cues, thinking"
    },
    {
      "from": "speech",
      "to": "display",
      "label": "bubble text"
    },
    {
      "from": "speech",
      "to": "renderer",
      "label": "cue per sentence, mouth amplitude"
    },
    {
      "from": "display",
      "to": "input",
      "label": "submit, stop"
    },
    {
      "from": "speech",
      "to": "voice-svc",
      "label": "synthesis request"
    },
    {
      "from": "senders",
      "to": "shell",
      "label": "signals, avatar commands, WebDriver session (verify feature)"
    },
    {
      "from": "shell",
      "to": "tools",
      "label": "signal, avatar-rpc events"
    },
    {
      "from": "tools",
      "to": "sources",
      "label": "signal events"
    },
    {
      "from": "shell",
      "to": "window",
      "label": "os_event every 5 s, drop release, tray",
      "arc": true
    }
  ],
  "nodes": [
    {
      "id": "user",
      "module": "user",
      "label": "user",
      "role": "The person at the desktop.",
      "paths": [],
      "external": true
    },
    {
      "id": "backend-request",
      "module": "backend",
      "label": "backend (request)",
      "role": "The backend agent on a request transport: one HTTP streaming call per turn, Responses or Chat Completions.",
      "paths": [],
      "external": true
    },
    {
      "id": "backend-push",
      "module": "backend",
      "label": "backend (push)",
      "role": "The backend agent on the push transport: one WebSocket that carries turns in and replies out, and holds the conversation under a chat id.",
      "paths": [],
      "external": true,
      "map": "integrations/hermes/platform/yui/docs/map.js"
    },
    {
      "id": "stt-service",
      "module": "voice-svc",
      "label": "STT service",
      "role": "The speech-to-text HTTP endpoint that turns a voice segment into text.",
      "paths": [],
      "external": true
    },
    {
      "id": "tts-service",
      "module": "voice-svc",
      "label": "TTS service",
      "role": "The speech synthesis HTTP endpoint and its voices API.",
      "paths": [],
      "external": true
    },
    {
      "id": "factorio",
      "module": "senders",
      "label": "plugins/factorio",
      "role": "The MCP server that polls the Factorio game mod over RCON and posts urgent game signals to the loopback ingress.",
      "paths": [],
      "external": true
    },
    {
      "id": "agent-hooks",
      "module": "senders",
      "label": "coding-agent hooks",
      "role": "The yui-notify plugin's Claude Code and Codex hooks, which post done and needs-input signals.",
      "paths": [],
      "external": true
    },
    {
      "id": "signal-producers",
      "module": "senders",
      "label": "signal producers",
      "role": "Outside producers that post signals for the character to speak about.",
      "paths": [],
      "external": true
    },
    {
      "id": "verifier",
      "module": "senders",
      "label": "verification driver",
      "role": "A WebdriverIO session that drives a bundle built with the `verify` feature over `127.0.0.1:4445`.",
      "paths": [],
      "external": true
    },
    {
      "id": "shell/core",
      "module": "shell",
      "label": "shell core",
      "role": "Builds the Tauri app: plugins, startup work, and the IPC command table.",
      "paths": [
        "src-tauri/src/main.rs",
        "src-tauri/src/lib.rs",
        "src-tauri/src/plugins.rs",
        "src-tauri/src/setup.rs",
        "src-tauri/src/commands.rs"
      ]
    },
    {
      "id": "shell/os-event-watcher",
      "module": "shell",
      "label": "os_event_watcher",
      "role": "Polls OS idle time and the frontmost window, lists windows, probes the drag release, and writes the witness log.",
      "paths": [
        "src-tauri/src/os_event_watcher"
      ]
    },
    {
      "id": "shell/agent-ingress",
      "module": "shell",
      "label": "agent_ingress",
      "role": "Loopback HTTP listener for signals and the avatar RPC round trip; routes `/presets/<id>/…` to the window bound to that preset and refuses a signals request holding an item over 16 KiB.",
      "paths": [
        "src-tauri/src/agent_ingress"
      ]
    },
    {
      "id": "shell/screenshot",
      "module": "shell",
      "label": "screenshot",
      "role": "Enumerates screen sources and captures a display off the main thread.",
      "paths": [
        "src-tauri/src/screenshot.rs"
      ]
    },
    {
      "id": "shell/image",
      "module": "shell",
      "label": "image encode",
      "role": "Resizes an image to a long-edge limit and encodes it as a JPEG data URL.",
      "paths": [
        "src-tauri/src/image_encode.rs"
      ]
    },
    {
      "id": "shell/browser",
      "module": "shell",
      "label": "browser",
      "role": "Relays a script or the guide to the installed ego lite CLI, holds one lock per task space and a backstop kill, builds the prelude, and owns the per-call screenshot folder.",
      "paths": [
        "src-tauri/src/browser"
      ]
    },
    {
      "id": "shell/window",
      "module": "shell",
      "label": "window control",
      "role": "OS-native window drag, logical window frames, the click-through toggle, and the quick-card window's macOS child-window link to its pet window.",
      "paths": [
        "src-tauri/src/drag.rs",
        "src-tauri/src/window_frame.rs",
        "src-tauri/src/passthrough.rs",
        "src-tauri/src/quick_card_dock.rs"
      ]
    },
    {
      "id": "shell/logs",
      "module": "shell",
      "label": "logs",
      "role": "The app log sink with date rotation and the turn-record JSONL file.",
      "paths": [
        "src-tauri/src/app_log.rs",
        "src-tauri/src/log_rotation.rs",
        "src-tauri/src/turn_log.rs"
      ]
    },
    {
      "id": "shell/tray",
      "module": "shell",
      "label": "tray",
      "role": "System tray menu with its show, hide, settings, and quit actions.",
      "paths": [
        "src-tauri/src/tray.rs"
      ]
    },
    {
      "id": "shell/imports",
      "module": "shell",
      "label": "asset imports",
      "role": "Native copy of user-picked VRM and voice clip files into app data, and the card file steps: a JSON or PNG card read, the PNG kept as the thumbnail copy, and the exported card write.",
      "paths": [
        "src-tauri/src/import_fs.rs",
        "src-tauri/src/vrm_import.rs",
        "src-tauri/src/voice_import.rs",
        "src-tauri/src/card_import.rs"
      ]
    },
    {
      "id": "contract",
      "module": "wiring",
      "label": "contract",
      "role": "TypeScript types of the wire schema between YUI and the backend.",
      "paths": [
        "src/contract"
      ]
    },
    {
      "id": "tauri-env",
      "module": "wiring",
      "label": "tauri-env",
      "role": "Detects whether the page runs inside the Tauri runtime.",
      "paths": [
        "src/tauri-env.ts"
      ]
    },
    {
      "id": "logger",
      "module": "wiring",
      "label": "logger",
      "role": "Namespaced frontend logger with a runtime level.",
      "paths": [
        "src/logger.ts"
      ]
    },
    {
      "id": "config",
      "module": "settings",
      "label": "config",
      "role": "Loads and validates configs/*.json, holds the reactive snapshot with hot reload, and names the secrets.",
      "paths": [
        "src/config"
      ]
    },
    {
      "id": "renderer",
      "module": "renderer",
      "label": "renderer core",
      "role": "The three.js scene and frame loop, VRM load and hot swap, and the routing of a control envelope into emotion and motion.",
      "paths": [
        "src/renderer"
      ]
    },
    {
      "id": "renderer/camera",
      "module": "renderer",
      "label": "camera",
      "role": "Fit-to-bounds framing, zoom, orbit, and the travel view window.",
      "paths": [
        "src/renderer/camera"
      ]
    },
    {
      "id": "renderer/expression",
      "module": "renderer",
      "label": "expression",
      "role": "Emotion crossfade, amplitude lip sync, and cursor gaze on the face.",
      "paths": [
        "src/renderer/expression"
      ]
    },
    {
      "id": "renderer/motion",
      "module": "renderer",
      "label": "motion",
      "role": "Clip cache, motion scheduling and playback, holds, and root yaw.",
      "paths": [
        "src/renderer/motion"
      ]
    },
    {
      "id": "renderer/geometry",
      "module": "renderer",
      "label": "geometry",
      "role": "Silhouette hit-testing, tap regions, and read-only screen probes of the model.",
      "paths": [
        "src/renderer/geometry"
      ]
    },
    {
      "id": "renderer/props",
      "module": "renderer",
      "label": "props",
      "role": "Furniture drawn in the character's scene.",
      "paths": [
        "src/renderer/props"
      ]
    },
    {
      "id": "settings",
      "module": "settings",
      "label": "settings",
      "role": "Persisted user settings, one localStorage-backed store per setting; a window's per-preset keys resolve under the `edit` query id, else the `preset` query id, else the active preset, yui.windows holds the presets wanted open as bound windows, and yui.pet-window.<id> marks one live; each preset's relations hold its relation toward the user and the other presets, in five bands with a daily cap on the tool's changes, and the relation entries a turn carries, and the device-wide Relations switch (yui.relations-enabled) turns relations off for every preset; each preset's card and send switch live in its yui.agent key, the device-wide yui.user-name holds what {{user}} resolves to, the device-wide yui.tts-readings holds the reading dictionary, the device-wide yui.theme holds the theme (dawn, hearth or system), and the device-wide yui.unified-chat holds the Unified chat switch, with the rule every pet and settings window reads for whether the unified chat window shows (the switch on, two or more open presets, a window can exist), and yui.unified-window the unified window's position.",
      "paths": [
        "src/settings"
      ]
    },
    {
      "id": "io/chat/stream",
      "module": "transport",
      "label": "chat stream",
      "role": "Request-transport streaming loops that turn a Responses or Chat Completions stream into chat stream events, with the client tool round trips.",
      "paths": [
        "src/io/chat/stream"
      ]
    },
    {
      "id": "io/chat/push",
      "module": "transport",
      "label": "push socket",
      "role": "The push transport's WebSocket, its frame shapes, and the queue that answers tool_call frames.",
      "paths": [
        "src/io/chat/push"
      ]
    },
    {
      "id": "io/chat/tools",
      "module": "tools",
      "label": "client tools",
      "role": "The tools the client declares to the backend and runs itself: generate_express, rate_relation, address_character, body_action, look, browser.",
      "paths": [
        "src/io/chat/tools"
      ]
    },
    {
      "id": "io/browser",
      "module": "tools",
      "label": "browser relay adapter",
      "role": "Invokes the relay commands: a script in a task space, or the installed version's guide.",
      "paths": [
        "src/io/browser"
      ]
    },
    {
      "id": "io/chat/vocabulary",
      "module": "tools",
      "label": "express vocabulary",
      "role": "Derives the emotion, motion, and voice-tone ids the agent may cue with.",
      "paths": [
        "src/io/chat/vocabulary"
      ]
    },
    {
      "id": "io/chat/conversation",
      "module": "conversation",
      "label": "conversation stores",
      "role": "Transcript, signal history, context history, response-id session, session diagnostics, and the overheard store and reader that hand a turn the other open presets' unheard lines.",
      "paths": [
        "src/io/chat/conversation"
      ]
    },
    {
      "id": "io/chat/record",
      "module": "conversation",
      "label": "turn record",
      "role": "Appends one JSONL record per completed turn or skipped fire.",
      "paths": [
        "src/io/chat/record"
      ]
    },
    {
      "id": "io/chat/models",
      "module": "transport",
      "label": "model list",
      "role": "Reads the model list of a chat endpoint.",
      "paths": [
        "src/io/chat/models"
      ]
    },
    {
      "id": "io/chat/secrets",
      "module": "transport",
      "label": "secret provider",
      "role": "Resolves each secret from its runtime store, then the build-time fallback.",
      "paths": [
        "src/io/chat/secret-provider.ts"
      ]
    },
    {
      "id": "io/chat/card",
      "module": "backend-call",
      "label": "card",
      "role": "Resolves a preset's card and its effective name, assembles the first system message and the post-history text with the {{char}}, {{user}}, {{original}} macros, and picks a greeting.",
      "paths": [
        "src/io/chat/card"
      ]
    },
    {
      "id": "io/voice/stt",
      "module": "input",
      "label": "voice input",
      "role": "Microphone capture, VAD segmentation, and the STT upload of each segment.",
      "paths": [
        "src/io/voice"
      ]
    },
    {
      "id": "io/voice/tts",
      "module": "speech",
      "label": "speech output",
      "role": "Sentence segmentation, synthesis, in-order playback held to one voice across pet windows, the reading dictionary applied to the TTS text, and the glue to the mouth and the bubble.",
      "paths": [
        "src/io/voice/tts"
      ]
    },
    {
      "id": "io/voice/filler",
      "module": "speech",
      "label": "filler",
      "role": "Filler phrases spoken while a turn is thinking, and the failure lines.",
      "paths": [
        "src/io/voice/filler"
      ]
    },
    {
      "id": "io/voice/voices",
      "module": "speech",
      "label": "voices",
      "role": "The speaker catalogue: selection, the voices API per provider, and voice import.",
      "paths": [
        "src/io/voice/voices"
      ]
    },
    {
      "id": "io/window/os-events",
      "module": "window",
      "label": "os events",
      "role": "The os_event listen seam, the frontmost-window tracker, and the own-origin fetch rule.",
      "paths": [
        "src/io/window"
      ]
    },
    {
      "id": "io/window/capture",
      "module": "tools",
      "label": "screen capture",
      "role": "Screen enumeration and screenshot capture through the shell.",
      "paths": [
        "src/io/window/capture"
      ]
    },
    {
      "id": "io/window/geometry",
      "module": "window",
      "label": "window geometry",
      "role": "Monitor and floor math, the quick card's dock, follow and snap rules, the travel and stationary frames, keep-on-screen, and the companion column windows' placement, width, focus, drag and content-height resize.",
      "paths": [
        "src/io/window/geometry"
      ]
    },
    {
      "id": "io/window/openers",
      "module": "window",
      "label": "window openers",
      "role": "Opens and places the message, settings, devtools, unified chat, quick-card, and pet windows, and a bound pet window's settings-<id>, message-<id> and quick-card-<id> by its preset id; keeps a request made before the quick-card window reports ready, closes those companions and watches their owner window.",
      "paths": [
        "src/io/window/openers"
      ]
    },
    {
      "id": "io/window/pet",
      "module": "window",
      "label": "pet window",
      "role": "The pet window's pointer gestures, click-through hit-test, gaze cursor, peek state, and summon hotkey.",
      "paths": [
        "src/io/window/pet"
      ]
    },
    {
      "id": "io/bridge/core",
      "module": "bridge",
      "label": "bridge core",
      "role": "The cross-window bus transport, the envelope that stamps the sender's preset and scopes delivery to it, and the owner and mirror pattern built on it.",
      "paths": [
        "src/io/bridge/core"
      ]
    },
    {
      "id": "io/bridge/settings",
      "module": "bridge",
      "label": "settings bridge",
      "role": "Typed cross-window settings bus: its channels scoped to the sender's preset, and the unscoped settings-changed, preset-changed, pet-windows-changed, character-addressed, user-turn-routed, voice-segment, speech-onset, user-turn-done, speech-stream, speech-stream-ask, speech-stream-control, stop-turns, settings-page and open-devtools.",
      "paths": [
        "src/io/bridge/settings-bridge.ts"
      ]
    },
    {
      "id": "io/bridge/message",
      "module": "bridge",
      "label": "message bridge",
      "role": "The preset-scoped bus between a pet window and its message window, and the message window's surfaces as a remote half.",
      "paths": [
        "src/io/bridge/message"
      ]
    },
    {
      "id": "io/bridge/delegations",
      "module": "bridge",
      "label": "delegations",
      "role": "The backend's background-work list: live store, persisted history, and its mirror.",
      "paths": [
        "src/io/bridge/delegations"
      ]
    },
    {
      "id": "io/bridge/reasoning",
      "module": "bridge",
      "label": "reasoning",
      "role": "The backend's reasoning text as the current turn writes it, and its mirror.",
      "paths": [
        "src/io/bridge/reasoning"
      ]
    },
    {
      "id": "io/bridge/push",
      "module": "bridge",
      "label": "push state bridge",
      "role": "Push socket state published to the windows that do not own the socket.",
      "paths": [
        "src/io/bridge/push"
      ]
    },
    {
      "id": "io/bridge/inbox",
      "module": "tools",
      "label": "inbox",
      "role": "Subscriptions to the shell's signals and avatar RPC channels, and the avatar executor that answers body commands addressed to its window, and the relations RPC that answers the relations routes from the window's relation store.",
      "paths": [
        "src/io/bridge/inbox"
      ]
    },
    {
      "id": "io/assets",
      "module": "settings",
      "label": "assets",
      "role": "VRM selection and import, and the card's file steps: the OS pickers for import and export, the V2 export envelope, and the thumbnail file URL the preset entry carries.",
      "paths": [
        "src/io/assets"
      ]
    },
    {
      "id": "io/guide",
      "module": "settings",
      "label": "guide docs",
      "role": "The bundled guide docs handed to the backend on an Ask press.",
      "paths": [
        "src/io/guide"
      ]
    },
    {
      "id": "io/image",
      "module": "transport",
      "label": "image encode",
      "role": "JPEG encoding of images sent to the backend.",
      "paths": [
        "src/io/image"
      ]
    },
    {
      "id": "io/locks",
      "module": "window",
      "label": "window locks",
      "role": "The exclusive Web Lock a window holds, shared by the voice gate and the turn gate.",
      "paths": [
        "src/io/locks"
      ]
    },
    {
      "id": "io/stage",
      "module": "input",
      "label": "stage pointer",
      "role": "Press travel every stage surface shares.",
      "paths": [
        "src/io/stage"
      ]
    },
    {
      "id": "dispatcher",
      "module": "dispatcher",
      "label": "dispatcher",
      "role": "The router: pumps the bus, classifies each envelope, and runs one backend call at a time, taking the cross-window turn lock first.",
      "paths": [
        "src/dispatcher"
      ]
    },
    {
      "id": "dispatcher/core",
      "module": "dispatcher",
      "label": "bus and gates",
      "role": "The event bus, tier classification, guardrails, the proactive pacer, and the turn gate.",
      "paths": [
        "src/dispatcher/core"
      ]
    },
    {
      "id": "dispatcher/tier1",
      "module": "dispatcher",
      "label": "tier 1",
      "role": "Local reactions that need no backend: directives, the posture ledger, and pin targets.",
      "paths": [
        "src/dispatcher/tier1"
      ]
    },
    {
      "id": "dispatcher/turn",
      "module": "turn",
      "label": "turn",
      "role": "The turn ledger, the TurnOutput and TurnFeed ports, push-turn ids, and the player of push reply frames.",
      "paths": [
        "src/dispatcher/turn"
      ]
    },
    {
      "id": "dispatcher/backend",
      "module": "backend-call",
      "label": "backend call",
      "role": "Builds the client context, sends a tier-2 event on the selected transport, settles the reply, and records the turn.",
      "paths": [
        "src/dispatcher/backend"
      ]
    },
    {
      "id": "dispatcher/sources/user-input",
      "module": "input",
      "label": "user input source",
      "role": "Turns typed text and STT results into bus envelopes.",
      "paths": [
        "src/dispatcher/sources"
      ]
    },
    {
      "id": "dispatcher/sources/idle-tick",
      "module": "sources",
      "label": "idle-tick sources",
      "role": "Proactive, schedule, milestone, and screen firing sources driven by the OS idle tick.",
      "paths": [
        "src/dispatcher/sources/idle-tick"
      ]
    },
    {
      "id": "dispatcher/sources/inbox",
      "module": "sources",
      "label": "inbox sources",
      "role": "Signals firing source with presence-gated buffering; a signal group routes by its delivery class, replaces a buffered group with the same event_id, and on return the batch catch-up goes out first with the urgent catch-up as the next turn.",
      "paths": [
        "src/dispatcher/sources/inbox"
      ]
    },
    {
      "id": "dispatcher/sources/gesture",
      "module": "sources",
      "label": "gesture sources",
      "role": "Tap, drag-hold, and window-drop firing sources, with the perch watch and placement.",
      "paths": [
        "src/dispatcher/sources/gesture"
      ]
    },
    {
      "id": "dispatcher/sources/wake",
      "module": "sources",
      "label": "wake source",
      "role": "Fires the wake candidate as she gets out of bed.",
      "paths": [
        "src/dispatcher/sources/wake"
      ]
    },
    {
      "id": "dispatcher/sources/addressed",
      "module": "sources",
      "label": "addressed source",
      "role": "Turns a character-addressed bridge event for this preset into the addressed.character candidate, and emits that event for this window's reply once it is over.",
      "paths": [
        "src/dispatcher/sources/addressed"
      ]
    },
    {
      "id": "dispatcher/sources/routed",
      "module": "sources",
      "label": "routed user source",
      "role": "Turns a user-turn-routed bridge event for this preset into a user turn that carries its send id, its mention and whether the user spoke it, and reports the done signal for that send id once the turn closes or is dropped.",
      "paths": [
        "src/dispatcher/sources/routed"
      ]
    },
    {
      "id": "ambient/liveliness",
      "module": "ambient",
      "label": "liveliness",
      "role": "Blink, idle sway, breath, and look-around, independent of the backend.",
      "paths": [
        "src/ambient/liveliness"
      ]
    },
    {
      "id": "ambient/locomotion",
      "module": "ambient",
      "label": "locomotion",
      "role": "Movement loops over the real window: stroll, perch, climb, jump, fall, and sit transitions.",
      "paths": [
        "src/ambient/locomotion"
      ]
    },
    {
      "id": "ambient/bed-scene",
      "module": "ambient",
      "label": "bed scene",
      "role": "Asleep on a bed at launch or on command, the wake, and the exit.",
      "paths": [
        "src/ambient/bed-scene"
      ]
    },
    {
      "id": "ui/surfaces",
      "module": "display",
      "label": "surfaces",
      "role": "The speech bubble and text input as one system, and the router between the pet window, the message window and the speech stream: while the unified chat window shows, the character's lines, asides, quotes and input go to the stream, and only notices stay on its own bubble.",
      "paths": [
        "src/ui/surfaces"
      ]
    },
    {
      "id": "ui/input",
      "module": "input",
      "label": "text input",
      "role": "The composer: submit, stop, mic button, and image attachments.",
      "paths": [
        "src/ui/input"
      ]
    },
    {
      "id": "ui/message",
      "module": "display",
      "label": "bubble and plate",
      "role": "The speech bubble, the typewriter that types each line at 40 ms per character as text arrives, the quoted user line or signal source lines, the reasoning disclosure, the backlog of the session's earlier lines, and the name plate and its turn state.",
      "paths": [
        "src/ui/message"
      ]
    },
    {
      "id": "ui/unified",
      "module": "display",
      "label": "unified chat",
      "role": "The unified chat window: the cast chips with each character's line state, which pick the recipient, a grip beside them and the box's name plate that drag the window, one dialogue box that shows one character's line at a time from per-preset lanes, the backlog labelled by recipient, the composer with the recipient in its placeholder, the @ list and stop, the one-at-a-time routing of a typed or spoken message to one preset or to all, a spoken message put in the field while any turn runs or a line holds or waits for the box, and another window's stop.",
      "paths": [
        "src/ui/unified"
      ]
    },
    {
      "id": "ui/signals",
      "module": "display",
      "label": "source line",
      "role": "The source line of a signal group: delivery-class dot, source, label; drawn by the bubble and by History.",
      "paths": [
        "src/ui/signals"
      ]
    },
    {
      "id": "ui/chips",
      "module": "display",
      "label": "chips",
      "role": "The status pill, which names a client-run tool's action, the delegation chip, the signal chip and its details sheet, and the voice-input status model.",
      "paths": [
        "src/ui/chips"
      ]
    },
    {
      "id": "ui/notices",
      "module": "display",
      "label": "notices",
      "role": "One-off and error notices.",
      "paths": [
        "src/ui/notices"
      ]
    },
    {
      "id": "ui/quick-controls",
      "module": "settings",
      "label": "quick controls",
      "role": "The settings panel that fills the settings window: a search field over a rail of the edited character's pages (Connection, Voice, Persona, Body, History) then every character's pages (Together, Listening and bubble, Permissions, Proactive, Motion and desktop, General), each page's scope line naming which; it heads with every character and its transport and window state, and a click edits it; a control the push transport cannot use stays, disabled, with its reason and a link to the chat protocol select; the Together page's Characters list turns each character on or off the desktop; the preset manage row's copy button copies a character's ingress URL and the Proactive URL line shows this window's; the preset strip shows this preset's relation line and the reasons card; the Persona page's Card section edits the preset's card, its send switch and the preset's name; the General page holds the device-wide user name and the Appearance row that picks the theme.",
      "paths": [
        "src/ui/quick-controls"
      ]
    },
    {
      "id": "ui/quick-card",
      "module": "settings",
      "label": "quick card",
      "role": "The card that fills the quick-card window: the face, name and transport line (on push, the socket's state), the Voice, Listen (main only), Keep bubble and Unified chat tiles over the same stores as their settings rows, the Body and Reference voice selects, a conversation reset that asks first, Turn off for a bound character, and All settings…; Escape and a click outside it close it, and its head is the drag handle the window moves by.",
      "paths": [
        "src/ui/quick-card"
      ]
    },
    {
      "id": "ui/devtools",
      "module": "settings",
      "label": "devtools ui",
      "role": "Developer Tools views: context inspector, advanced settings, motion preview.",
      "paths": [
        "src/ui/devtools"
      ]
    },
    {
      "id": "ui/i18n",
      "module": "settings",
      "label": "i18n",
      "role": "The persisted locale and its string catalogs.",
      "paths": [
        "src/ui/i18n.ts",
        "src/ui/i18n"
      ]
    },
    {
      "id": "ui/theme",
      "module": "settings",
      "label": "theme",
      "role": "Writes the theme the store resolves, `system` through the OS appearance, as `data-theme` on each window's root.",
      "paths": [
        "src/ui/theme"
      ]
    },
    {
      "id": "app/bootstrap",
      "module": "wiring",
      "label": "pet bootstrap",
      "role": "The pet window's config-derived composition root and the shared teardown bag.",
      "paths": [
        "src/app"
      ]
    },
    {
      "id": "app/relations",
      "module": "wiring",
      "label": "relations wiring",
      "role": "Wires rate_relation's open-preset targets and the ingress relations RPC to this window's relation store.",
      "paths": [
        "src/app/relations"
      ]
    },
    {
      "id": "app/turn",
      "module": "wiring",
      "label": "turn wiring",
      "role": "Connects voice, dispatcher, sources, vocabulary, and the push transport into the chat turn; while the unified chat window shows, main's speech goes to that window and the user starting to speak has it answer like its stop button while a character runs.",
      "paths": [
        "src/app/turn"
      ]
    },
    {
      "id": "app/card-io",
      "module": "wiring",
      "label": "card io wiring",
      "role": "The card's settings-panel ports: io's file steps and settings' preset creator, bound to one registry, spread by the settings window's wiring.",
      "paths": [
        "src/app/card-io"
      ]
    },
    {
      "id": "app/turn/card",
      "module": "wiring",
      "label": "card wiring",
      "role": "Binds the card module to the window's stores, preset, UI language, and config for the backend caller, and performs the greeting after a session reset and once at the first boot of a preset a card import created.",
      "paths": [
        "src/app/turn/wire-card.ts",
        "src/app/turn/wire-greeting.ts"
      ]
    },
    {
      "id": "app/signal-chips",
      "module": "wiring",
      "label": "signal chips wiring",
      "role": "Creates the signal chips and the fold store they share with the delegation chip, and hands the signals source its arrival callback.",
      "paths": [
        "src/app/signal-chips"
      ]
    },
    {
      "id": "app/stage",
      "module": "wiring",
      "label": "stage wiring",
      "role": "Binds the renderer, gestures, locomotion, the bed scene, and the window sources to the pet stage.",
      "paths": [
        "src/app/stage"
      ]
    },
    {
      "id": "app/cross-window",
      "module": "wiring",
      "label": "cross-window wiring",
      "role": "Per-window settings sync over the bridge and storage events.",
      "paths": [
        "src/app/cross-window"
      ]
    },
    {
      "id": "app/settings",
      "module": "wiring",
      "label": "settings wiring",
      "role": "Store bags, the config store with its live merges and reload, avatar selection, and the settings side the settings and quick-card windows share.",
      "paths": [
        "src/app/settings"
      ]
    },
    {
      "id": "app/pet-windows",
      "module": "wiring",
      "label": "bound pet windows",
      "role": "The open-window list kept in step across windows, main's reconcile and open, the live key each window holds until it closes, the companions a bound pet window opens, and the orphan close.",
      "paths": [
        "src/app/pet-windows"
      ]
    },
    {
      "id": "app/controls",
      "module": "wiring",
      "label": "controls wiring",
      "role": "The pet window's stage context menu that sends the quick-card open request from the character's live silhouette (the renderer's alpha grab), the popped-out surfaces' settings asks, and the settings window's guide and Developer Tools requests.",
      "paths": [
        "src/app/controls"
      ]
    },
    {
      "id": "app/quick-card-window",
      "module": "wiring",
      "label": "quick-card window wiring",
      "role": "The quick-card window's wiring: the settings side it shares with the settings window, the card's ports, the mirrored push socket and voice state, the dock that places the window docked beside the character, follows her window, detaches on a head drag and snaps a near drop back, and the close that hides the window when no YUI window holds focus.",
      "paths": [
        "src/app/quick-card-window"
      ]
    },
    {
      "id": "app/message",
      "module": "wiring",
      "label": "message-window wiring",
      "role": "Draws surface ops from the pet window; names the character for both windows' plates and backlogs: the pet window resolves the effective name and sends it, the message window mirrors it.",
      "paths": [
        "src/app/message"
      ]
    },
    {
      "id": "app/unified",
      "module": "wiring",
      "label": "unified-window wiring",
      "role": "Main opens the unified chat window while it shows and destroys it otherwise, and the window closing itself turns the Unified chat switch off.",
      "paths": [
        "src/app/unified"
      ]
    },
    {
      "id": "app/settings-window",
      "module": "wiring",
      "label": "settings-window wiring",
      "role": "Composes the settings window over the stores of the preset it edits (`?edit=`, else its own), opens it on the page of `?page=` and on later page requests, and mirrors the voice toggle in main only.",
      "paths": [
        "src/app/settings-window"
      ]
    },
    {
      "id": "app/voice",
      "module": "wiring",
      "label": "voice fix",
      "role": "The desktop pill's setup-needed tap.",
      "paths": [
        "src/app/voice"
      ]
    },
    {
      "id": "app/dev",
      "module": "wiring",
      "label": "dev globals",
      "role": "DEV-only console handles.",
      "paths": [
        "src/app/dev"
      ]
    },
    {
      "id": "windows",
      "module": "wiring",
      "label": "window entries",
      "role": "One entry file per window, loaded by the matching HTML file.",
      "paths": [
        "src/windows"
      ]
    }
  ],
  "edges": [
    {
      "id": "input-submit",
      "from": "ui/input",
      "to": "ui/surfaces",
      "carries": "submit and stop handlers",
      "kind": "callback",
      "transport": "shared"
    },
    {
      "id": "surfaces-submit",
      "from": "ui/surfaces",
      "to": "dispatcher/sources/user-input",
      "carries": "userInput.submit(text, images)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "stt-http",
      "from": "io/voice/stt",
      "to": "stt-service",
      "carries": "POST {stt_base_url}/audio/transcriptions, transcript text back",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "stt-submit",
      "from": "io/voice/stt",
      "to": "dispatcher/sources/user-input",
      "carries": "onVoiceSegment(text) → submitVoice while the unified chat window is hidden; while it shows, the voice-segment exchange carries the text",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice.ts"
    },
    {
      "id": "user-input-bus",
      "from": "dispatcher/sources/user-input",
      "to": "dispatcher/core",
      "carries": "bus.push(BusEnvelope): user.text_submitted, user.voice_segment_ready",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "bus-dispatcher",
      "from": "dispatcher/core",
      "to": "dispatcher",
      "carries": "bus.pop() in the pump, classify(env), guardrails.evaluate(env), pacer gap",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "dispatcher-ledger",
      "from": "dispatcher",
      "to": "dispatcher/turn",
      "carries": "turnLog.begin(env) → Turn, settle(id)",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "ledger-quote",
      "from": "dispatcher/turn",
      "to": "ui/surfaces",
      "carries": "onTurnAdmitted, utteranceStart → quoteUser, quoteSignals, settleQuote, clearQuote",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "dispatcher-busy",
      "from": "dispatcher",
      "to": "ui/surfaces",
      "carries": "subscribeBusy → setBusy",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "dispatcher-failure",
      "from": "dispatcher",
      "to": "ui/surfaces",
      "carries": "onUserTurnFailed → showInputError",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "dispatcher-backend",
      "from": "dispatcher",
      "to": "dispatcher/backend",
      "carries": "backendCaller.call(turn, signal) → TurnOutcome",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "context-posture",
      "from": "dispatcher/tier1",
      "to": "dispatcher/backend",
      "carries": "getBodyState(): posture and since",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "context-frontmost",
      "from": "io/window/os-events",
      "to": "dispatcher/backend",
      "carries": "getFrontmost(): app and title",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "context-screenshot",
      "from": "io/window/capture",
      "to": "dispatcher/backend",
      "carries": "getScreenshot(): image attachment",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "context-settings",
      "from": "settings",
      "to": "dispatcher/backend",
      "carries": "agent and screenshot settings read per turn",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "context-endpoints",
      "from": "config",
      "to": "dispatcher/backend",
      "carries": "getEndpoints(): config endpoints merged with the settings override",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/settings/wire-config.ts"
    },
    {
      "id": "context-guide",
      "from": "io/guide",
      "to": "dispatcher/backend",
      "carries": "renderGuideBlock(guide): the guide: block of the client context",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "conversation-backend",
      "from": "io/chat/conversation",
      "to": "dispatcher/backend",
      "carries": "previous response id, pending tool outputs, transcript entries after the last boundary; the greeting entries among them on a fresh Responses chain",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "card-config",
      "from": "config",
      "to": "io/chat/card",
      "carries": "config.persona: the framing, the {{user}} fallback word, and the default card of each UI language",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-card.ts"
    },
    {
      "id": "card-settings",
      "from": "settings",
      "to": "io/chat/card",
      "carries": "agentSettings.get(): card (null means the UI language's default) and send_card; userNameSettings.get().name for {{user}}",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-card.ts"
    },
    {
      "id": "card-backend",
      "from": "io/chat/card",
      "to": "dispatcher/backend",
      "carries": "getCardText(): {system, postHistory}, null on push or with the switch off; read per turn",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "greeting-transcript",
      "from": "app/turn/card",
      "to": "io/chat/conversation",
      "carries": "greetLocal: one greeting with its macros substituted → append({role: assistant, greeting: true}) while the session after the last boundary is empty",
      "kind": "call",
      "transport": "request",
      "wiring": "src/app/turn/wire-greeting.ts"
    },
    {
      "id": "greeting-speech",
      "from": "app/turn/card",
      "to": "io/voice/tts",
      "carries": "greetLocal → turnOutput.speak(text, {turn_id: greeting:<ts>, event_name: greeting})",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-greeting.ts"
    },
    {
      "id": "session-reset-announce",
      "from": "ui/quick-controls",
      "to": "io/bridge/settings",
      "carries": "Start fresh → announceSessionReset → yui://session-reset {presetId}, scoped to the preset; the pet window also greets directly",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/turn/wire-greeting.ts"
    },
    {
      "id": "session-reset-stop",
      "from": "io/bridge/settings",
      "to": "dispatcher/turn",
      "carries": "yui://session-reset for this window's preset → stopTurn() before the greeting",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/turn/wire-greeting.ts"
    },
    {
      "id": "overheard-backend",
      "from": "io/chat/conversation",
      "to": "dispatcher/backend",
      "carries": "other presets' entries after the per-pair cursor; the cursor commits after a turn ends ok",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "relations-context",
      "from": "settings",
      "to": "dispatcher/backend",
      "carries": "readRelationLines(store.all(), this window's preset, the registry list, the Relations switch) → ClientContext.relations, read per turn; none while the switch is off",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "backend-stream",
      "from": "dispatcher/backend",
      "to": "io/chat/stream",
      "carries": "stream(config, request, {apiKey, tools})",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "stream-http",
      "from": "io/chat/stream",
      "to": "backend-request",
      "carries": "Responses or Chat Completions streaming request with client_context, user text, images, tools",
      "kind": "http",
      "transport": "request"
    },
    {
      "id": "stream-events",
      "from": "io/chat/stream",
      "to": "dispatcher/backend",
      "carries": "ChatStreamEvent: speech_delta, express, tool_status, reasoning, usage, completed",
      "kind": "call",
      "transport": "request"
    },
    {
      "id": "backend-output",
      "from": "dispatcher/backend",
      "to": "dispatcher/turn",
      "carries": "TurnOutput: interrupt, thinkingStart, thinkingEnd; on request also delta, cue, end, speak, abort",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "backend-feed",
      "from": "dispatcher/backend",
      "to": "dispatcher/turn",
      "carries": "TurnFeed: toolStatus, reasoning, replied, ended",
      "kind": "call",
      "transport": "request"
    },
    {
      "id": "settle-renderer",
      "from": "dispatcher/backend",
      "to": "renderer",
      "carries": "applyDirective(envelope) when no cue was streamed with speech",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "backend-record",
      "from": "dispatcher/backend",
      "to": "io/chat/conversation",
      "carries": "recordSentTurn: transcript entries, signal records, context history, response id; usage",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "backend-turn-record",
      "from": "dispatcher/backend",
      "to": "io/chat/record",
      "carries": "appendRecord(turn record)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "record-shell",
      "from": "io/chat/record",
      "to": "shell/logs",
      "carries": "append_turn_record {line}",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "backend-push-send",
      "from": "dispatcher/backend",
      "to": "io/chat/push",
      "carries": "pushTurn(PushTurnFrame {turn_id, client_context, text, images})",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "backend-push-wait",
      "from": "dispatcher/backend",
      "to": "dispatcher/turn",
      "carries": "pushTurns.opened, awaitTurnEnd, abandon",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "push-ws",
      "from": "io/chat/push",
      "to": "backend-push",
      "carries": "frames out: hello, turn, vocabulary, reset, stop, tool_result, playback",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "push-ws-in",
      "from": "backend-push",
      "to": "io/chat/push",
      "carries": "frames in: ready, speech, render, turn_end, error, reasoning, tool_status, tool_call, delegations",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "push-render",
      "from": "io/chat/push",
      "to": "dispatcher/turn",
      "carries": "speech, render, turn_end, error → renderTurn.stream, render, close; pushTurns.ended",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/wire-push.ts"
    },
    {
      "id": "push-feed",
      "from": "io/chat/push",
      "to": "dispatcher/turn",
      "carries": "tool_status, reasoning → TurnFeed.toolStatus, reasoning; a client-run tool's own running, done, failed by call id, and the backend's tool_status for it dropped",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/wire-push.ts"
    },
    {
      "id": "render-output",
      "from": "dispatcher/turn",
      "to": "io/voice/tts",
      "carries": "render-turn → TurnOutput: releaseMute, cueWithSpeech, delta, silentCue, end",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "render-conversation",
      "from": "dispatcher/turn",
      "to": "io/chat/conversation",
      "carries": "assistant transcript entry of a rendered reply, and what the turn said into its signal records",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "render-record",
      "from": "dispatcher/turn",
      "to": "io/chat/record",
      "carries": "RenderRecord",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "push-usage",
      "from": "io/chat/push",
      "to": "io/chat/conversation",
      "carries": "turn_end usage → sessionDiagnostics.setUsage",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "push-delegations",
      "from": "io/chat/push",
      "to": "io/bridge/delegations",
      "carries": "delegations frame → delegationHistory.merge, delegations.replace",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/wire-push.ts"
    },
    {
      "id": "previous-playback",
      "from": "dispatcher/backend",
      "to": "io/chat/push",
      "carries": "previous-turn record that ended failed → sendPlayback({turn_id, ended})",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/playback.ts"
    },
    {
      "id": "output-speech",
      "from": "dispatcher/turn",
      "to": "io/voice/tts",
      "carries": "TurnOutput implemented over speech playback: delta, cue, end, interrupt",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "output-filler",
      "from": "dispatcher/turn",
      "to": "io/voice/filler",
      "carries": "thinkingStart → fillerLoop.start, thinkingEnd → stop, toolStatus → onToolRunning",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "filler-speech",
      "from": "io/voice/filler",
      "to": "io/voice/tts",
      "carries": "speechPlayback.speakAside(text)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "tts-http",
      "from": "io/voice/tts",
      "to": "tts-service",
      "carries": "POST {tts_base_url}/v1/audio/speech or /v1/tts per sentence, audio back",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "speech-bubble",
      "from": "io/voice/tts",
      "to": "ui/surfaces",
      "carries": "beginSpeech, pushSpeech, endSpeech, finishSpeech",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "surfaces-bubble",
      "from": "ui/surfaces",
      "to": "ui/message",
      "carries": "speech bubble text, user quote, signal source lines, reasoning disclosure",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "speech-renderer",
      "from": "io/voice/tts",
      "to": "renderer",
      "carries": "applyDirective at each sentence start; setMouthOpen by amplitude; stopMouth and easeEmotionToNeutral at playback end",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "renderer-expression",
      "from": "renderer",
      "to": "renderer/expression",
      "carries": "setEmotion, setMouthOpen, stopMouth, easeEmotionToNeutral, gaze",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "renderer-motion",
      "from": "renderer",
      "to": "renderer/motion",
      "carries": "playMotion, setMotionHold, setIdleVariants, setBodyYaw",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "speech-ledger",
      "from": "io/voice/tts",
      "to": "dispatcher/turn",
      "carries": "reportAudioOwed → turnLog.setAudioOwed",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "speech-previous",
      "from": "io/voice/tts",
      "to": "dispatcher/backend",
      "carries": "onUtteranceStart(identity), onUtteranceEnd(ended, SpokenSplit, identity) → previous-turn",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice.ts"
    },
    {
      "id": "feed-tool",
      "from": "ui/surfaces",
      "to": "ui/chips",
      "carries": "showTool(toolId, action), finishTool, hideTool → status pill",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/windows/main.ts"
    },
    {
      "id": "feed-surfaces",
      "from": "dispatcher/turn",
      "to": "ui/surfaces",
      "carries": "TurnFeed.onToolStatus {state, tool_id} → showTool, finishTool, hideTool",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "feed-reasoning",
      "from": "dispatcher/turn",
      "to": "io/bridge/reasoning",
      "carries": "TurnFeed: append, finish, interrupt",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "reasoning-bubble",
      "from": "io/bridge/reasoning",
      "to": "ui/message",
      "carries": "ReasoningState {text, live} → reasoning disclosure",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "vocabulary-derive",
      "from": "config",
      "to": "io/chat/vocabulary",
      "carries": "deriveExpressVocabulary(config, emotion_text table, express-motion selection)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/vocabulary/wire-vocabulary.ts"
    },
    {
      "id": "vocabulary-settings",
      "from": "settings",
      "to": "io/chat/vocabulary",
      "carries": "expressMotionSettings change → announce",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/vocabulary/wire-vocabulary.ts"
    },
    {
      "id": "vocabulary-tools",
      "from": "io/chat/vocabulary",
      "to": "io/chat/tools",
      "carries": "createClientTools(vocabulary, windowTools) per turn",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "tools-backend",
      "from": "io/chat/tools",
      "to": "dispatcher/backend",
      "carries": "declared tool schemas of the turn; rate_relation's toward enum is read from the open presets as the schema is built",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "tool-switches-backend",
      "from": "io/chat/tools",
      "to": "dispatcher/backend",
      "carries": "switch states of the declared tools, read per turn",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "vocabulary-push",
      "from": "io/chat/vocabulary",
      "to": "io/chat/push",
      "carries": "hello.vocabulary; sendVocabulary on each announce",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "tools-push",
      "from": "io/chat/tools",
      "to": "io/chat/push",
      "carries": "hello.tools: the window tools (rate_relation in every pet window, browser in every pet window under Tauri, body_action and look in main)",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/push-stores.ts"
    },
    {
      "id": "stream-tools",
      "from": "io/chat/stream",
      "to": "io/chat/tools",
      "carries": "runClientCall → executeClientTool(tool, args, request signal, call id, request turn id) → ClientToolResult; tool_status with the call's action",
      "kind": "call",
      "transport": "request"
    },
    {
      "id": "push-tools",
      "from": "io/chat/push",
      "to": "io/chat/tools",
      "carries": "tool_call frame → executeClientTool(tool, args, signal aborted on the turn's cut, socket loss, reset, disposal, call id, frame turn_id) → tool_result frame",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "tools-executor",
      "from": "io/chat/tools",
      "to": "io/bridge/inbox",
      "carries": "body_action → executor.command(args); look → executor.state(), perchTargets()",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "tools-capture",
      "from": "io/chat/tools",
      "to": "io/window/capture",
      "carries": "look at screen → capturer.captureAt(point)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "tools-browser",
      "from": "io/chat/tools",
      "to": "io/browser",
      "carries": "relay.run(space, code) / relay.guide() → RunOutcome",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/io/chat/tools/pet-window-tools.ts"
    },
    {
      "id": "settings-tool-switches",
      "from": "settings",
      "to": "io/chat/tools",
      "carries": "look.screen and browser switches, read when a call runs and when the tools line is built",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "settings-relation-targets",
      "from": "settings",
      "to": "io/chat/tools",
      "carries": "yui.presets names and the open presets (active and yui.windows) → rate_relation's toward enum, without this window's preset",
      "kind": "storage",
      "transport": "shared",
      "wiring": "src/app/relations/wire-relations.ts"
    },
    {
      "id": "relations-tool",
      "from": "io/chat/tools",
      "to": "settings",
      "carries": "rate_relation → store.rate(target id, delta, why, now) → {band, applied, clamped}; the daily cap and the range clamp it; while the Relations switch is off the call answers error: relations are off and writes nothing",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/relations/wire-relations.ts"
    },
    {
      "id": "capture-shell",
      "from": "io/window/capture",
      "to": "shell/screenshot",
      "carries": "list_screen_sources, capture_screen, capture_screen_at",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "browser-shell",
      "from": "io/browser",
      "to": "shell/browser",
      "carries": "browser_run {space, code}, browser_guide",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "push-image",
      "from": "io/chat/push",
      "to": "io/image",
      "carries": "fitTurnImages → JPEG re-encode of turn and tool-result images",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "input-image",
      "from": "ui/input",
      "to": "io/image",
      "carries": "JPEG re-encode of composer attachments",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "agent-hooks-signals",
      "from": "agent-hooks",
      "to": "shell/agent-ingress",
      "carries": "POST /signals {source claude-code|codex, event_type agent.done|agent.needs_input, delivery, event_id <session_id>:<phase>, label}, or the same path under /presets/<id>/",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "signals-ingress",
      "from": "signal-producers",
      "to": "shell/agent-ingress",
      "carries": "POST /signals {signals, envelope {delivery: urgent|batched, event_id, label?}}, or the same path under /presets/<id>/; a missing envelope or an item over 16 KiB refuses the request",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "relations-ingress",
      "from": "signal-producers",
      "to": "shell/agent-ingress",
      "carries": "GET /relations; PUT /relations {<user or preset id>: {value, updated_at, log, note?}}, refused with 400 outside the ranges or for an unknown key; JSON answer, or the same path under /presets/<id>/ answered by that window",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "avatar-ingress",
      "from": "signal-producers",
      "to": "shell/agent-ingress",
      "carries": "GET /avatar/state, GET /avatar/perch-targets, POST /avatar/command; JSON answer, or the same paths under /presets/<id>/ answered by that window",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "factorio-ingress",
      "from": "factorio",
      "to": "shell/agent-ingress",
      "carries": "POST /signals {signals, envelope delivery:\"urgent\"}",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "ingress-inbox",
      "from": "shell/agent-ingress",
      "to": "io/bridge/inbox",
      "carries": "targeted emit_to per window — bare routes → main, /presets/<id>/ → pet-<id>; signals-inbox (signals, envelope verbatim with its label, and the server ts), avatar-rpc (the avatar and relations routes), ingress-dead; each inbox listens with its own window's label",
      "kind": "tauri-event",
      "transport": "shared"
    },
    {
      "id": "inbox-rpc-response",
      "from": "io/bridge/inbox",
      "to": "shell/agent-ingress",
      "carries": "avatar_rpc_response {id, result} for state, perch_targets, command, relations_get and relations_put; accepted only from the window the request was emitted to",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "relations-rpc",
      "from": "io/bridge/inbox",
      "to": "settings",
      "carries": "relations_get → store.all(); relations_put → store.replace(body) → the stored body",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/relations/wire-relations.ts"
    },
    {
      "id": "relations-ui",
      "from": "settings",
      "to": "ui/quick-controls",
      "carries": "this preset's store.all() and subscribe, re-rendered with motion on a write, and again on a cross-window reload of the store",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/settings-window/wire-settings-window.ts"
    },
    {
      "id": "relations-set",
      "from": "ui/quick-controls",
      "to": "settings",
      "carries": "the Relations section's slider → store.set(target, value, \"set by the user\", now): the range clamps, no daily cap; the strip, the pet window (over the broadcast) and the next turn read the new value",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/ui/quick-controls/quick-controls.ts"
    },
    {
      "id": "ingress-start",
      "from": "settings",
      "to": "shell/agent-ingress",
      "carries": "start_agent_ingress {port} at boot when External signals is on; main only, a bound window starts no ingress",
      "kind": "tauri-command",
      "transport": "shared",
      "wiring": "src/app/stage/wire-window-sources.ts"
    },
    {
      "id": "preset-ids-sync",
      "from": "settings",
      "to": "shell/agent-ingress",
      "carries": "sync_preset_ids {ids}: the registry's preset ids, so a prefixed route tells a closed window (503) from an unknown id (404); main only, a bound window is refused",
      "kind": "tauri-command",
      "transport": "shared",
      "wiring": "src/app/pet-windows/wire-preset-ids-sync.ts"
    },
    {
      "id": "inbox-sources",
      "from": "io/bridge/inbox",
      "to": "dispatcher/sources/inbox",
      "carries": "onSignals(SignalsPayload)",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "inbox-notice",
      "from": "io/bridge/inbox",
      "to": "ui/notices",
      "carries": "onIngressDead({port}) → speech-bubble notice",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "executor-perch",
      "from": "io/bridge/inbox",
      "to": "dispatcher/sources/gesture",
      "carries": "perch.placeOn, perch.release, perch.perchTargets",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-window-sources.ts"
    },
    {
      "id": "executor-locomotion",
      "from": "io/bridge/inbox",
      "to": "ambient/locomotion",
      "carries": "noteAgentMove() cancels the movers; onRelocated() → faller.drop",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-locomotion.ts"
    },
    {
      "id": "executor-bed",
      "from": "io/bridge/inbox",
      "to": "ambient/bed-scene",
      "carries": "bed.phase, lieDown, getUp, interrupt",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/create-avatar-bed.ts"
    },
    {
      "id": "executor-posture",
      "from": "io/bridge/inbox",
      "to": "dispatcher",
      "carries": "noteAvatarMoved(); reads getPosture()",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-locomotion.ts"
    },
    {
      "id": "os-event",
      "from": "shell/os-event-watcher",
      "to": "io/window/os-events",
      "carries": "os_event {event_name: \"os_idle_tick\", ts, data: {os_idle_ms, frontmost_app, frontmost_title}} every 5 s",
      "kind": "tauri-event",
      "transport": "shared"
    },
    {
      "id": "os-idle-tick",
      "from": "io/window/os-events",
      "to": "dispatcher/sources/idle-tick",
      "carries": "subscribeOsEvent: idle and frontmost samples",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "os-presence",
      "from": "io/window/os-events",
      "to": "dispatcher/sources/inbox",
      "carries": "subscribeOsEvent: presence for buffered delivery",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "drop-release-pet",
      "from": "shell/os-event-watcher",
      "to": "io/window/pet",
      "carries": "window_drop_release: the dragged window's label, heard by every window",
      "kind": "tauri-event",
      "transport": "shared"
    },
    {
      "id": "drop-release-source",
      "from": "shell/os-event-watcher",
      "to": "dispatcher/sources/gesture",
      "carries": "window_drop_release: the dragged window's label; a quick-card window's release settles nothing in a pet window",
      "kind": "tauri-event",
      "transport": "shared",
      "wiring": "src/app/stage/wire-window-sources.ts"
    },
    {
      "id": "gesture-list-windows",
      "from": "dispatcher/sources/gesture",
      "to": "shell/os-event-watcher",
      "carries": "list_windows → WindowAtPoint[]",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "locomotion-list-windows",
      "from": "ambient/locomotion",
      "to": "shell/os-event-watcher",
      "carries": "list_windows → WindowAtPoint[]",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "settings-idle-tick",
      "from": "settings",
      "to": "dispatcher/sources/idle-tick",
      "carries": "cue lists, presence threshold, screen-watch thresholds",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "settings-inbox",
      "from": "settings",
      "to": "dispatcher/sources/inbox",
      "carries": "agentNotifySettings.enabled",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "idle-tick-bus",
      "from": "dispatcher/sources/idle-tick",
      "to": "dispatcher/core",
      "carries": "bus.push: proactive.<cue>, schedule.<cue>, time_milestone.first_activity, proactive.screen_app_switched, proactive.screen_long_session",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "inbox-bus",
      "from": "dispatcher/sources/inbox",
      "to": "dispatcher/core",
      "carries": "bus.push: signals.batch, signals.catchup, signals.urgent, signals.urgent_catchup",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "gesture-bus",
      "from": "dispatcher/sources/gesture",
      "to": "dispatcher/core",
      "carries": "bus.push: user.tap, user.tap_region, user.pat_*, proactive.touch_<region>, proactive.head_pat, proactive.drag_held, user.window_sit_drop, user.peek_drop, proactive.window_sit, proactive.peek, user.window_sit_exit, user.peek_exit",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/stage/wire-gestures.ts"
    },
    {
      "id": "wake-bus",
      "from": "dispatcher/sources/wake",
      "to": "dispatcher/core",
      "carries": "bus.push: proactive.wake {cause, signals}",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "signals-drain",
      "from": "dispatcher/sources/inbox",
      "to": "dispatcher/sources/idle-tick",
      "carries": "signalsSource.drain(): signal groups that ride the milestone envelope",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "signals-drain-wake",
      "from": "dispatcher/sources/inbox",
      "to": "dispatcher/sources/wake",
      "carries": "signalsSource.drain(): signal groups that ride the wake envelope",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "drop-restore",
      "from": "dispatcher",
      "to": "dispatcher/sources/inbox",
      "carries": "onTurnDropped(env) → restore",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "bus-drop-restore",
      "from": "dispatcher/core",
      "to": "dispatcher/sources/inbox",
      "carries": "onDrop(env) of a refused push → restore",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/windows/main.ts"
    },
    {
      "id": "pacer-inbox",
      "from": "dispatcher/core",
      "to": "dispatcher/sources/inbox",
      "carries": "composePacedPipelineBusy: pacer gap and dispatcher busy hold delivery",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "busy-inbox-urgent",
      "from": "dispatcher/core",
      "to": "dispatcher/sources/inbox",
      "carries": "raw dispatcher busy state for the urgent inbox instance (no pacer)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "screen-skip-record",
      "from": "dispatcher/sources/idle-tick",
      "to": "io/chat/record",
      "carries": "skip record of a screen fire the pacer held",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "pet-gestures",
      "from": "io/window/pet",
      "to": "dispatcher/sources/gesture",
      "carries": "onClick(pos), pat start and end, drag start and end → tap source, drag-hold source",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-gestures.ts"
    },
    {
      "id": "pet-drag-bus",
      "from": "io/window/pet",
      "to": "dispatcher/core",
      "carries": "bus.push: user.drag_start, user.drag_end",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-gestures.ts"
    },
    {
      "id": "dispatcher-tier1",
      "from": "dispatcher",
      "to": "dispatcher/tier1",
      "carries": "tier1.render(env)",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "tier1-renderer",
      "from": "dispatcher/tier1",
      "to": "renderer",
      "carries": "applyDirective(ControlEnvelope), setPerchTarget, setPeekTarget, setMotionMirror, easeEmotionToNeutral",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "tier1-peek",
      "from": "dispatcher/tier1",
      "to": "io/window/pet",
      "carries": "peek.enter(), peek.exit()",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "tap-renderer",
      "from": "renderer/geometry",
      "to": "dispatcher/sources/gesture",
      "carries": "getTapPoints(), getPerchProbe(), getCurrentMotion()",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-gestures.ts"
    },
    {
      "id": "liveliness-renderer",
      "from": "ambient/liveliness",
      "to": "renderer",
      "carries": "onTick: head, spine, and chest rotation, blink",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/stage-renderer.ts"
    },
    {
      "id": "locomotion-renderer",
      "from": "ambient/locomotion",
      "to": "renderer/motion",
      "carries": "playMotion, preloadMotion, setBodyYaw; reads anchors and motion time",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-locomotion.ts"
    },
    {
      "id": "locomotion-frame",
      "from": "ambient/locomotion",
      "to": "io/window/geometry",
      "carries": "travel frame: setPosition, setViewWindow, keep-on-screen pause",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "frame-shell",
      "from": "ambient/locomotion",
      "to": "shell/window",
      "carries": "set_frame_logical {x, y, width, height} for the travel and stationary frames",
      "kind": "tauri-command",
      "transport": "shared",
      "wiring": "src/ambient/locomotion/travel/wire-travel-frame.ts"
    },
    {
      "id": "locomotion-bus",
      "from": "ambient/locomotion",
      "to": "dispatcher/core",
      "carries": "bus.push: avatar.walk_start, avatar.walk_end, avatar.climb_start, avatar.climb_end, avatar.jump, avatar.window_sit, user.fall_land, proactive.dropped",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "locomotion-hit-test",
      "from": "ambient/locomotion",
      "to": "io/window/pet",
      "carries": "hitTest.setMoving(bool)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-locomotion.ts"
    },
    {
      "id": "drop-fall",
      "from": "dispatcher/sources/gesture",
      "to": "ambient/locomotion",
      "carries": "onDragMiss, onSitLost → faller.drop",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-locomotion.ts"
    },
    {
      "id": "locomotion-perch",
      "from": "ambient/locomotion",
      "to": "dispatcher/sources/gesture",
      "carries": "adoptSit, armedSit, suspendSit, resumeSit, abandonSit, release",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-window-sources.ts"
    },
    {
      "id": "dispatcher-walk",
      "from": "dispatcher",
      "to": "ambient/locomotion",
      "carries": "subscribeBusy and isReflexTurn cancel a stroll; isPipelineBusy gates the movers",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/stage/wire-locomotion.ts"
    },
    {
      "id": "bed-renderer",
      "from": "ambient/bed-scene",
      "to": "renderer",
      "carries": "playMotion, setMotionHold, setOrbit, setSpringBonesHeld, setGazeSuppressed, loadProp",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-bed-scene.ts"
    },
    {
      "id": "renderer-props",
      "from": "renderer",
      "to": "renderer/props",
      "carries": "loadProp",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "bed-liveliness",
      "from": "ambient/bed-scene",
      "to": "ambient/liveliness",
      "carries": "setAsleep(bool)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-bed-scene.ts"
    },
    {
      "id": "bed-frame",
      "from": "ambient/bed-scene",
      "to": "io/window/geometry",
      "carries": "stationary frame: park, refit, release",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/scene-frame.ts"
    },
    {
      "id": "bed-bus",
      "from": "ambient/bed-scene",
      "to": "dispatcher/core",
      "carries": "bus.push: avatar.bed_start, avatar.bed_end",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-bed-scene.ts"
    },
    {
      "id": "bed-wake",
      "from": "ambient/bed-scene",
      "to": "dispatcher/sources/wake",
      "carries": "onWake(cause) → wakeSource.fire",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "pet-drag-shell",
      "from": "io/window/pet",
      "to": "shell/window",
      "carries": "drag_window, set_click_through {ignore}",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "hit-test-renderer",
      "from": "renderer/geometry",
      "to": "io/window/pet",
      "carries": "renderer.hitTest(point) → click-through decision",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-stage.ts"
    },
    {
      "id": "cursor-gaze",
      "from": "io/window/pet",
      "to": "renderer/expression",
      "carries": "setGazeCursor(pos)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-stage.ts"
    },
    {
      "id": "tray-pet",
      "from": "shell/tray",
      "to": "io/window/pet",
      "carries": "tray_toggle → peek exit; the summon hotkey from the same wiring registers in main only",
      "kind": "tauri-event",
      "transport": "shared",
      "wiring": "src/app/stage/wire-summon.ts"
    },
    {
      "id": "tray-message",
      "from": "shell/tray",
      "to": "io/window/openers",
      "carries": "tray_toggle → hide or reopen main's message window",
      "kind": "tauri-event",
      "transport": "shared"
    },
    {
      "id": "window-geometry",
      "from": "app/stage",
      "to": "settings",
      "carries": "yui.window.<label> {x,y,width,height}: written after the OS drag ends and after a Ctrl+wheel resize; applied once at boot, clamped on screen, before the faller places the window and the bed scene parks it",
      "kind": "storage",
      "transport": "shared",
      "wiring": "src/app/stage/wire-window-geometry.ts"
    },
    {
      "id": "settings-edit-target",
      "from": "ui/quick-controls",
      "to": "app/settings-window",
      "carries": "the preset id picked in the strip's character header; the window navigates to settings.html with `?edit=<id>` and rebuilds over that preset's stores and bridge stamp; main's active preset and every pet window are untouched",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/settings-window/wire-settings-window.ts"
    },
    {
      "id": "settings-open-windows",
      "from": "windows",
      "to": "io/window/openers",
      "carries": "openSettings(page?): the status pill's capture button opens no page, the voice-setup fix and the delegation chip Connection; a new settings window at settings.html with `?preset=<id>` and `&page=<page>`, else the open one is shown, focused and asked for the page",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/windows/main.ts"
    },
    {
      "id": "settings-open-bootstrap",
      "from": "app/bootstrap",
      "to": "io/window/openers",
      "carries": "openSettings(\"conn\"): the turn error's fix button and the first-run hint's action",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "user-quick-card",
      "from": "user",
      "to": "ui/quick-card",
      "carries": "a right-click on the stage opens the card's window docked beside her; a tile, a select, Reset, Turn off or All settings… press; Escape or a click outside it closes it; a pointerdown on its head without a button starts the window drag",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "quick-card-stores",
      "from": "ui/quick-card",
      "to": "settings",
      "carries": "a tile flips the store of its settings row (TTS on, keep bubble, the Unified chat switch) and repaints on its change; Turn off → petWindows.close(id)",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-ports.ts"
    },
    {
      "id": "quick-card-registry",
      "from": "settings",
      "to": "ui/quick-card",
      "carries": "the window's preset entry (name, face) and the chat transport in effect, repainted on a registry or endpoints change",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-ports.ts"
    },
    {
      "id": "quick-card-push",
      "from": "io/chat/push",
      "to": "ui/quick-card",
      "carries": "on push, getState() and onState → the head's connected, connecting, reconnecting, refused or offline line",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-ports.ts"
    },
    {
      "id": "quick-card-vrm",
      "from": "io/assets",
      "to": "ui/quick-card",
      "carries": "vrmSelection list, active id and subscribe → the Body select; a pick → swapVrm(option)",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-ports.ts"
    },
    {
      "id": "quick-card-voice",
      "from": "io/voice/voices",
      "to": "ui/quick-card",
      "carries": "speakerSelection list, active id and subscribe → the Reference voice select; a pick → swapSpeaker(option)",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-ports.ts"
    },
    {
      "id": "quick-card-listen",
      "from": "ui/chips",
      "to": "ui/quick-card",
      "carries": "main only: voiceInputStatus get, set(listening or idle) and subscribe → the Listen tile",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-ports.ts"
    },
    {
      "id": "quick-card-reset",
      "from": "ui/quick-card",
      "to": "io/chat/conversation",
      "carries": "Reset, once confirmed → resetConversation, the History page's start fresh: the session id and diagnostics cleared, transcript.startNewSession, announceSessionReset, and on push sendReset",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-ports.ts"
    },
    {
      "id": "quick-card-open",
      "from": "app/controls",
      "to": "app/quick-card-window",
      "carries": "the stage context menu's open request for the quick-card window, sent once the window has reported ready",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/controls/wire-pet-controls.ts"
    },
    {
      "id": "quick-card-ready",
      "from": "app/quick-card-window",
      "to": "app/controls",
      "carries": "yui://quick-card-ready: the card window has booted; the controller then sends a request it held since the create",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/controls/wire-pet-controls.ts"
    },
    {
      "id": "quick-card-placement",
      "from": "app/quick-card-window",
      "to": "io/window/geometry",
      "carries": "quickCardBeside, followOwner, snapTarget and clampQuickCard: the docked placement 12px from her roomier side, the follow of the owner window's moves, the 24px drop magnet, and the work-area clamp of a grown card",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-dock.ts"
    },
    {
      "id": "quick-card-drag-shell",
      "from": "app/quick-card-window",
      "to": "shell/window",
      "carries": "drag_window from a head pointerdown: the OS drag of the card window; quick_card_attach {parentLabel} and quick_card_detach: the macOS child-window link that moves the docked card with her pet window (false elsewhere)",
      "kind": "tauri-command",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-dock.ts"
    },
    {
      "id": "drop-release-quick-card",
      "from": "shell/os-event-watcher",
      "to": "app/quick-card-window",
      "carries": "window_drop_release {label}: the drop of a drag the card started, then the 24px magnet",
      "kind": "tauri-event",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/quick-card-dock.ts"
    },
    {
      "id": "settings-open-controls",
      "from": "app/controls",
      "to": "io/window/openers",
      "carries": "openSettings(\"conn\"): the message window's settings button",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/controls/wire-pet-controls.ts"
    },
    {
      "id": "quick-card-open-settings",
      "from": "app/quick-card-window",
      "to": "io/window/openers",
      "carries": "openSettings(): the card's All settings…, which lands the settings window on this character",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/quick-card-window/wire-quick-card-window.ts"
    },
    {
      "id": "settings-page-emit",
      "from": "io/window/openers",
      "to": "io/bridge/settings",
      "carries": "an open settings window shown → yui://settings-page {preset: id or null, page?}",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/windows/main.ts"
    },
    {
      "id": "settings-page",
      "from": "io/bridge/settings",
      "to": "app/settings-window",
      "carries": "yui://settings-page {preset, page?}, unscoped: the window whose preset is `preset` (main's for null) switches to the character, by reloading without `?edit=` when it edits another, and selects the page; other windows drop it",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/settings-window/wire-settings-page.ts"
    },
    {
      "id": "settings-devtools-request",
      "from": "ui/quick-controls",
      "to": "io/bridge/settings",
      "carries": "the General page's Developer Tools button → yui://open-devtools, no payload",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/settings-window/wire-settings-window.ts"
    },
    {
      "id": "devtools-open",
      "from": "io/bridge/settings",
      "to": "io/window/openers",
      "carries": "yui://open-devtools, unscoped: main's pet window opens the devtools window; a bound pet window does not listen",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/controls/wire-devtools-request.ts"
    },
    {
      "id": "settings-camera",
      "from": "settings",
      "to": "renderer/camera",
      "carries": "camera zoom and orbit, idle throttle → setZoom, setOrbit",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/stage/wire-pet-stage.ts"
    },
    {
      "id": "renderer-camera",
      "from": "renderer",
      "to": "renderer/camera",
      "carries": "setFraming, setViewWindow",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "controls-settings",
      "from": "ui/quick-controls",
      "to": "settings",
      "carries": "store commit → localStorage yui.*, or yui.<preset-id>.* for a per-preset key; the Characters list writes yui.windows, and open returns false with nothing written while 4 presets, main's included, are open; the manage popover's Use in main writes the active id, and activate returns false while a preset is open or live; the Card section writes the card and send switch into yui.agent and renames the preset in yui.presets; the General page writes the user name into yui.user-name",
      "kind": "storage",
      "transport": "shared"
    },
    {
      "id": "settings-broadcast",
      "from": "settings",
      "to": "io/bridge/settings",
      "carries": "subscribe(broadcastSettings) → emitSettingsChanged after 200 ms",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/cross-window/wire-window-sync.ts"
    },
    {
      "id": "settings-reload",
      "from": "io/bridge/settings",
      "to": "settings",
      "carries": "yui://settings-changed → reloadFromStorage on every broadcast store; the preset registry is not one: it rides yui://preset-changed, with its storage event as the fallback",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/cross-window/wire-window-sync.ts"
    },
    {
      "id": "preset-changed",
      "from": "settings",
      "to": "io/bridge/settings",
      "carries": "registry edit → yui://preset-changed {active}; the receiving window rereads the registry and reloads when the active preset changed; a bound window rereads and keeps its preset instead",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/settings/wire-preset.ts"
    },
    {
      "id": "preset-stop",
      "from": "settings",
      "to": "dispatcher/turn",
      "carries": "active preset change → stopTurn() before the pet window reloads; main only, a bound window neither follows the active preset nor reloads",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/settings/wire-preset.ts"
    },
    {
      "id": "pet-windows-changed",
      "from": "settings",
      "to": "io/bridge/settings",
      "carries": "open-list edit → yui://pet-windows-changed, no payload; the receiving window reloads yui.windows and the live keys from storage and sends nothing back",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/pet-windows/wire-pet-windows-sync.ts"
    },
    {
      "id": "pet-windows-reconcile",
      "from": "settings",
      "to": "io/window/openers",
      "carries": "main only: yui.windows and the live keys → prune against the registry and the windows that exist, then open each wanted preset that has no window",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/pet-windows/wire-pet-windows-reconcile.ts"
    },
    {
      "id": "bound-window-close",
      "from": "settings",
      "to": "io/window/openers",
      "carries": "bound window only: its id leaves yui.windows → close its companions, dispose its stores, clear the live key, emit the change, and close",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/pet-windows/wire-bound-window.ts"
    },
    {
      "id": "settings-guardrails",
      "from": "settings",
      "to": "dispatcher/core",
      "carries": "guardrail caps, addressed_chain_max included → guardrails.setConfig(getGuardrails())",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/cross-window/wire-window-sync.ts"
    },
    {
      "id": "settings-pacer",
      "from": "settings",
      "to": "dispatcher/core",
      "carries": "pacer gap → pacer.noteIntervalChanged()",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "settings-turn-gate",
      "from": "settings",
      "to": "dispatcher/core",
      "carries": "yui.one-voice flag → turnGate enabled(), read on each acquire",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "settings-overheard",
      "from": "settings",
      "to": "io/chat/conversation",
      "carries": "yui.presets names and active id, yui.windows open list → the overheard reader's preset names and other preset ids",
      "kind": "storage",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "transcripts-overheard",
      "from": "settings",
      "to": "io/chat/conversation",
      "carries": "another preset's yui.<id>.chat_transcript → readTranscriptAfterBoundary, read-only",
      "kind": "storage",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "user-turn-routed",
      "from": "ui/unified",
      "to": "dispatcher/sources/routed",
      "carries": "yui://user-turn-routed {sendId, to, text, mention?, via?}, unscoped, one per target in sequence, filtered on `to`; the next target waits for the previous one's user-turn-done; via \"voice\" marks a spoken message",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/windows/unified-main.ts"
    },
    {
      "id": "voice-segment",
      "from": "app/turn",
      "to": "ui/unified",
      "carries": "yui://voice-segment {text}, unscoped: main's recognized speech while the unified chat window shows; that window routes it like a typed message, or puts it in the field while any turn runs or a line holds or waits for the box",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "speech-onset",
      "from": "app/turn",
      "to": "ui/unified",
      "carries": "yui://speech-onset, unscoped, when the user starts speaking while the unified chat window shows and barge-in is on: that window answers like its stop button while a character runs",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "user-turn-done",
      "from": "dispatcher/sources/routed",
      "to": "ui/unified",
      "carries": "yui://user-turn-done {sendId, preset}, unscoped, when the turn for a send id closed or was dropped before it began",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "backlog-transcript-pet",
      "from": "io/chat/conversation",
      "to": "ui/message",
      "carries": "the pet window's chat-history store: entriesAfterLastBoundary → the backlog, read on each open",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/ui/surfaces/wire.ts"
    },
    {
      "id": "backlog-transcript-message",
      "from": "io/chat/conversation",
      "to": "ui/message",
      "carries": "yui.<id>.chat_transcript → readTranscriptAfterBoundary → the message window's backlog, read on each open",
      "kind": "storage",
      "transport": "shared",
      "wiring": "src/windows/message-main.ts"
    },
    {
      "id": "unified-transcripts",
      "from": "io/chat/conversation",
      "to": "ui/unified",
      "carries": "every open preset's yui.<id>.chat_transcript \u2192 readTranscriptAfterBoundary, read-only, re-read on settings-changed, pet-windows-changed, preset-changed, focus and storage",
      "kind": "storage",
      "transport": "shared",
      "wiring": "src/windows/unified-main.ts"
    },
    {
      "id": "unified-open",
      "from": "app/unified",
      "to": "io/window/openers",
      "carries": "open() while the unified chat window shows, close() otherwise, which destroys the window without a close request; one frameless 340 px window labelled unified",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "mention-trigger",
      "from": "dispatcher/sources/routed",
      "to": "dispatcher/core",
      "carries": "bus.push: user.text_submitted {text, send_id, mention?} \u2192 client_context trigger.mention \u2192 the `trigger: user message (addressed to the character|everyone)` suffix",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "settings-push",
      "from": "settings",
      "to": "io/chat/push",
      "carries": "endpoints override or chat key change → socket open, close, retarget",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/wire-push.ts"
    },
    {
      "id": "settings-speech",
      "from": "settings",
      "to": "io/voice/tts",
      "carries": "TTS on or off, speaker, lip-sync gain, read per utterance",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "settings-stt",
      "from": "settings",
      "to": "io/voice/stt",
      "carries": "VAD silence window and barge-in, read per segment",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "settings-idle-motion",
      "from": "settings",
      "to": "renderer/motion",
      "carries": "idle-motion selection → setIdleVariants",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/settings/wire-avatar.ts"
    },
    {
      "id": "config-renderer",
      "from": "config",
      "to": "renderer",
      "carries": "hot reload: emotionRegistry, motions, avatar sections",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/settings/wire-config.ts"
    },
    {
      "id": "config-guardrails",
      "from": "config",
      "to": "dispatcher/core",
      "carries": "hot reload: guardrails section",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/settings/wire-config.ts"
    },
    {
      "id": "assets-renderer",
      "from": "io/assets",
      "to": "renderer",
      "carries": "VRM selection → loadVRM(url)",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/settings/wire-avatar.ts"
    },
    {
      "id": "assets-shell",
      "from": "io/assets",
      "to": "shell/imports",
      "carries": "import_vrm_file, remove_user_vrm",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "card-io-ui",
      "from": "ui/quick-controls",
      "to": "io/assets",
      "carries": "Import card\u2026 \u2192 importCardFromFile (JSON or PNG in); Export card \u2192 exportCardToFile (V2 JSON out, extensions.yui.filler \u2190 the preset's filler pools, omitted while every pool is empty); the photo dialog \u2192 loadPhotoSize (a photo's natural size)",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/card-io/wire-card-io.ts"
    },
    {
      "id": "card-preset-ui",
      "from": "ui/quick-controls",
      "to": "settings",
      "carries": "Import card\u2026 \u2192 settings/preset/import-card-preset.ts createPresetFromCard: the preset from the card, the card's extensions.yui.filler \u2192 the new preset's filler value, the thumbnail retained and framed by default (retainFramedThumbnail \u2192 loadPhotoSize \u2192 defaultCrop) onto the entry with its crop, the pending greeting, and activation; a failure removes both",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/card-io/wire-card-io.ts"
    },
    {
      "id": "card-shell",
      "from": "io/assets",
      "to": "shell/imports",
      "carries": "import_card_file, retain_card_thumbnail, pick_preset_photo, remove_card_thumbnail, write_card_file",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "greeting-pending",
      "from": "settings",
      "to": "app/turn/card",
      "carries": "yui.greeting-pending written by a card import; the preset's next boot consumes it and greets once",
      "kind": "storage",
      "transport": "shared"
    },
    {
      "id": "preset-photo",
      "from": "ui/quick-controls",
      "to": "settings",
      "carries": "the manage row's photo button \u2192 the photo dialog (pickPresetPhoto \u2192 pick_preset_photo stores cards/<id>.png) \u2192 registry.setThumbnail(file URL with ?v=<time>, crop)",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/card-io/wire-card-io.ts"
    },
    {
      "id": "card-thumb-ui",
      "from": "settings",
      "to": "ui/quick-controls",
      "carries": "PresetEntry.thumbnail and crop \u2192 the strip's and the card section's face (avatarEl)",
      "kind": "callback",
      "transport": "shared"
    },
    {
      "id": "voices-shell",
      "from": "io/voice/voices",
      "to": "shell/imports",
      "carries": "import_voice_file, rename_user_voice, remove_user_voice",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "voices-http",
      "from": "io/voice/voices",
      "to": "tts-service",
      "carries": "voices list, upload, delete per provider",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "voices-speech",
      "from": "io/voice/voices",
      "to": "io/voice/tts",
      "carries": "speakerSelection.getActive() per utterance",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "logger-shell",
      "from": "logger",
      "to": "shell/logs",
      "carries": "log records through the log plugin",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "models-http",
      "from": "io/chat/models",
      "to": "backend-request",
      "carries": "GET {baseUrl}/models",
      "kind": "http",
      "transport": "request"
    },
    {
      "id": "controls-models",
      "from": "ui/quick-controls",
      "to": "io/chat/models",
      "carries": "read the model list for the Connection page",
      "kind": "call",
      "transport": "request"
    },
    {
      "id": "controls-guide",
      "from": "ui/quick-controls",
      "to": "dispatcher/sources/user-input",
      "carries": "the settings window's Ask press → yui://help-guide {guide, text} → the pet window's submitGuide(guide, text)",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/controls/wire-help-guide.ts"
    },
    {
      "id": "stt-status",
      "from": "io/voice/stt",
      "to": "ui/chips",
      "carries": "onState → voiceInputStatus.set",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "status-stt",
      "from": "ui/chips",
      "to": "io/voice/stt",
      "carries": "voiceInputStatus toggle → start or stop STT",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice.ts"
    },
    {
      "id": "stop-dispatcher",
      "from": "ui/surfaces",
      "to": "dispatcher",
      "carries": "onStop → stopTurn: dispatcher.cancel()",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "stop-push-turns",
      "from": "ui/surfaces",
      "to": "dispatcher/turn",
      "carries": "stopTurn: pushTurns.cut()",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "stop-speech",
      "from": "ui/surfaces",
      "to": "io/voice/tts",
      "carries": "stopTurn: speechPlayback.interrupt()",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/turn-core.ts"
    },
    {
      "id": "stop-push",
      "from": "ui/surfaces",
      "to": "io/chat/push",
      "carries": "sendStop(turnIds)",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/wire-push.ts"
    },
    {
      "id": "barge-in-speech",
      "from": "io/voice/stt",
      "to": "io/voice/tts",
      "carries": "onSpeechActive with speech outstanding → speechPlayback.interrupt({muteCurrentTurn}), fillerLoop.stop(); while the unified chat window shows and barge-in is on, onSpeechActive → speech-onset",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/voice/wire-voice-pipeline.ts"
    },
    {
      "id": "barge-in-push",
      "from": "io/voice/stt",
      "to": "dispatcher/turn",
      "carries": "onBargeIn → pushTurns.cut()",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/voice/wire-voice.ts"
    },
    {
      "id": "user-supersede",
      "from": "dispatcher",
      "to": "dispatcher/backend",
      "carries": "supersedeByUser: abort the call in flight, drop pending",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "push-publish",
      "from": "io/chat/push",
      "to": "io/bridge/push",
      "carries": "publishPushSocket: PushSocketState, scoped to the sender's preset",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/push-stores.ts"
    },
    {
      "id": "push-requests",
      "from": "io/bridge/push",
      "to": "io/chat/push",
      "carries": "yui://push-reset → stopTurn and sendReset; yui://push-reconnect → reconnectNow; scoped to the sender's preset",
      "kind": "bridge",
      "transport": "push",
      "wiring": "src/app/turn/push/push-stores.ts"
    },
    {
      "id": "push-state-controls",
      "from": "io/bridge/push",
      "to": "ui/quick-controls",
      "carries": "push socket state in the Connection tab",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "delegations-chip",
      "from": "io/bridge/delegations",
      "to": "ui/chips",
      "carries": "delegations store or mirror → delegation chip",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "signals-chips",
      "from": "dispatcher/sources/inbox",
      "to": "ui/chips",
      "carries": "each parsed signal group, buffered or not → signal chip (onArrival, passed from bootstrap-configured through wireDispatcherSources)",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "history-chips",
      "from": "io/chat/conversation",
      "to": "ui/chips",
      "carries": "signal records → what YUI said on a chip's card, by event_id",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/signal-chips/wire-signal-chips.ts"
    },
    {
      "id": "chips-fold",
      "from": "settings",
      "to": "ui/chips",
      "carries": "the per-device fold choice → signal chips and delegation chip",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/signal-chips/wire-signal-chips.ts"
    },
    {
      "id": "delegations-controls",
      "from": "io/bridge/delegations",
      "to": "ui/quick-controls",
      "carries": "delegations and delegation history → Session section",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "conversation-controls",
      "from": "io/chat/conversation",
      "to": "ui/quick-controls",
      "carries": "sessions() and signal records → History tab; session diagnostics → Session section",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "conversation-devtools",
      "from": "io/chat/conversation",
      "to": "ui/devtools",
      "carries": "contextHistory → context inspector",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "surfaces-remote",
      "from": "ui/surfaces",
      "to": "io/bridge/message",
      "carries": "RemoteSurfaces: MessageSurfaceOp on yui://message-surface, scoped to the sender's preset",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/ui/surfaces/wire.ts"
    },
    {
      "id": "remote-surfaces",
      "from": "io/bridge/message",
      "to": "ui/surfaces",
      "carries": "MessageControlOp on yui://message-control: submit, stop, input-open, input-error-action, speech-action, dock, open-settings, ready; scoped to the sender's preset",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/ui/surfaces/wire.ts"
    },
    {
      "id": "surfaces-openers",
      "from": "ui/surfaces",
      "to": "io/window/openers",
      "carries": "message-window mode popped or docked → open, hide",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/ui/surfaces/wire.ts"
    },
    {
      "id": "user-input",
      "from": "user",
      "to": "ui/input",
      "carries": "typed text, attached images, the send and stop button",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "user-voice",
      "from": "user",
      "to": "io/voice/stt",
      "carries": "microphone audio",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "user-window",
      "from": "user",
      "to": "io/window/pet",
      "carries": "taps, pats, drags, and drops on the character; Shift-drag orbit; Ctrl-wheel resize",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "user-settings",
      "from": "user",
      "to": "ui/quick-controls",
      "carries": "quick-controls and settings-window edits",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "message-source-line",
      "from": "ui/message",
      "to": "ui/signals",
      "carries": "renderSourceLine for each source line in the bubble's quote slot",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "history-source-line",
      "from": "ui/quick-controls",
      "to": "ui/signals",
      "carries": "renderSourceLine for each signal record of a History row",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "bubble-user",
      "from": "ui/message",
      "to": "user",
      "carries": "speech bubble text, the quoted user line, the signal source lines, reasoning",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "chips-user",
      "from": "ui/chips",
      "to": "user",
      "carries": "status pill, delegation chip, signal chips and their details sheet",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "voice-user",
      "from": "io/voice/tts",
      "to": "user",
      "carries": "synthesized voice and filler phrases",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "character-user",
      "from": "renderer",
      "to": "user",
      "carries": "the character on screen: expression, mouth, motion",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "address-character",
      "from": "io/chat/tools",
      "to": "dispatcher/sources/addressed",
      "carries": "address_character → record(turnId, to, handoff); refused for an unknown or closed target and for a second call in one turn",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "turn-closed-addressed",
      "from": "dispatcher/core",
      "to": "dispatcher/sources/addressed",
      "carries": "onTurnClosed {id, outcome, spokeText, sendId?, userText?} once per turn, at the over edge or when the next turn displaces it",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "character-addressed-emit",
      "from": "dispatcher/sources/addressed",
      "to": "io/bridge/settings",
      "carries": "yui://character-addressed {from, name, to, text, ts, user_message?}, unscoped, after the reply's turn ended with speech and its playback finished",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/windows/main.ts"
    },
    {
      "id": "character-addressed-receive",
      "from": "io/bridge/settings",
      "to": "dispatcher/sources/addressed",
      "carries": "yui://character-addressed {from, name, to, text, ts, user_message?}, unscoped, filtered on `to`",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "addressed-bus",
      "from": "dispatcher/sources/addressed",
      "to": "dispatcher/core",
      "carries": "bus.push: addressed.character {from, name, line, user_message?}; the chain cap addressed_chain_max drops the third in a row without a user turn",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/turn/wire-sources.ts"
    },
    {
      "id": "speech-stream",
      "from": "ui/surfaces",
      "to": "ui/unified",
      "carries": "yui://speech-stream {preset, op}, unscoped: op is a message-window op (begin, push, end, finish, hide, quote, quote-signals, settle-quote, clear-quote, busy, name, summon-input, input-error) the pet's stream half sends while the unified chat window shows; busy and name always",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/ui/surfaces/wire.ts"
    },
    {
      "id": "speech-stream-ask",
      "from": "ui/unified",
      "to": "ui/surfaces",
      "carries": "yui://speech-stream-ask, unscoped, once the unified window subscribed: each pet window's stream half restates its name and busy state",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/windows/unified-main.ts"
    },
    {
      "id": "stop-turns",
      "from": "ui/unified",
      "to": "app/turn",
      "carries": "yui://stop-turns, unscoped, from the unified chat window's stop button or its answer to speech onset: every pet window runs the stop button's stopTurn",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/windows/unified-main.ts"
    },
    {
      "id": "unified-shown",
      "from": "settings",
      "to": "ui/surfaces",
      "carries": "the shown predicate (get, subscribe): the router's suppression, getMode docked and the message window hidden while it shows",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/windows/main.ts"
    },
    {
      "id": "unified-shown-settings-controls",
      "from": "settings",
      "to": "ui/quick-controls",
      "carries": "the settings window's own shown predicate: the Separate message window row disabled with its reason while it shows",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/settings-window/wire-settings-window.ts"
    },
    {
      "id": "unified-shown-open",
      "from": "settings",
      "to": "app/unified",
      "carries": "the shown predicate main opens and destroys the window on",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "speech-stream-control",
      "from": "ui/unified",
      "to": "io/bridge/message",
      "carries": "yui://speech-stream-control {preset, op: input-error-action}, unscoped: a click on an error's fix in the unified window; the stream half of the window whose preset it names runs the fix",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/windows/unified-main.ts"
    },
    {
      "id": "unified-close-switch",
      "from": "app/unified",
      "to": "settings",
      "carries": "the window's close request (×) → yui.unified-chat {enabled: false}, then yui://settings-changed",
      "kind": "storage",
      "transport": "shared",
      "wiring": "src/windows/unified-main.ts"
    },
    {
      "id": "unified-window-position",
      "from": "settings",
      "to": "io/window/openers",
      "carries": "yui.unified-window {x, y} physical px, written as the unified window moves and read when main creates it",
      "kind": "storage",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
    },
    {
      "id": "settings-theme",
      "from": "settings",
      "to": "ui/theme",
      "carries": "themeSettings.subscribe → data-theme on the window root; the pet, settings, message, unified and devtools windows each call applyTheme",
      "kind": "call",
      "transport": "shared",
      "wiring": "src/windows/main.ts"
    }
  ],
  "flows": [
    {
      "id": "turn",
      "title": "A user turn",
      "steps": [
        {
          "from": "user",
          "label": "types text or speaks",
          "edges": [
            "user-input",
            "user-voice"
          ],
          "to": "input"
        },
        {
          "from": "input",
          "label": "user.text_submitted or user.voice_segment_ready",
          "edges": [
            "user-input-bus"
          ],
          "to": "dispatcher"
        },
        {
          "from": "dispatcher",
          "label": "A user turn aborts the call in flight, classifies as tier 2, and opens in the ledger",
          "edges": [
            "bus-dispatcher",
            "user-supersede",
            "dispatcher-ledger"
          ]
        },
        {
          "from": "dispatcher",
          "label": "send button becomes stop",
          "edges": [
            "dispatcher-busy"
          ],
          "to": "display"
        },
        {
          "from": "turn",
          "label": "quote the user",
          "edges": [
            "ledger-quote"
          ],
          "to": "display"
        },
        {
          "from": "dispatcher",
          "label": "backendCaller.call(turn)",
          "edges": [
            "dispatcher-backend"
          ],
          "to": "backend-call"
        },
        {
          "from": "backend-call",
          "label": "interrupt previous speech, thinkingStart",
          "edges": [
            "backend-output"
          ],
          "to": "turn"
        },
        {
          "from": "turn",
          "label": "filler loop starts",
          "edges": [
            "output-filler"
          ],
          "to": "speech"
        },
        {
          "from": "backend-call",
          "label": "Builds the client context: posture, frontmost app, screenshot, settings, previous turn",
          "edges": [
            "context-posture",
            "context-frontmost",
            "context-screenshot",
            "context-settings",
            "context-endpoints"
          ]
        },
        {
          "from": "backend-call",
          "label": "stream(request) with tool schemas and conversation state",
          "edges": [
            "backend-stream"
          ],
          "to": "transport",
          "transport": "request"
        },
        {
          "from": "transport",
          "label": "Responses or Chat Completions streaming request",
          "edges": [
            "stream-http"
          ],
          "to": "backend",
          "transport": "request"
        },
        {
          "from": "backend",
          "label": "stream chunks",
          "edges": [
            "stream-http"
          ],
          "to": "transport",
          "transport": "request"
        },
        {
          "from": "transport",
          "label": "ChatStreamEvent: speech_delta, express, tool_status, reasoning, usage",
          "edges": [
            "stream-events"
          ],
          "to": "backend-call",
          "transport": "request"
        },
        {
          "from": "backend-call",
          "label": "TurnOutput delta and cue; TurnFeed tool status and reasoning",
          "edges": [
            "backend-output",
            "backend-feed"
          ],
          "to": "turn",
          "transport": "request"
        },
        {
          "from": "backend-call",
          "label": "pushTurn(turn frame)",
          "edges": [
            "backend-push-send"
          ],
          "to": "transport",
          "transport": "push"
        },
        {
          "from": "backend-call",
          "label": "pushTurns.opened, awaitTurnEnd",
          "edges": [
            "backend-push-wait"
          ],
          "to": "turn",
          "transport": "push"
        },
        {
          "from": "transport",
          "label": "turn frame",
          "edges": [
            "push-ws"
          ],
          "to": "backend",
          "transport": "push"
        },
        {
          "from": "backend",
          "label": "speech, render, tool_status, reasoning, turn_end frames",
          "edges": [
            "push-ws-in"
          ],
          "to": "transport",
          "transport": "push"
        },
        {
          "from": "transport",
          "label": "render-turn plays speech and render frames; TurnFeed tool status and reasoning",
          "edges": [
            "push-render",
            "push-feed"
          ],
          "to": "turn",
          "transport": "push"
        },
        {
          "from": "turn",
          "label": "TurnOutput: delta, cue, end",
          "edges": [
            "output-speech"
          ],
          "to": "speech"
        },
        {
          "from": "turn",
          "label": "tool status on the pill, reasoning",
          "edges": [
            "feed-surfaces"
          ],
          "to": "display"
        },
        {
          "from": "speech",
          "label": "Segments sentences and synthesizes each one through the TTS service",
          "edges": [
            "tts-http"
          ]
        },
        {
          "from": "speech",
          "label": "beginSpeech, pushSpeech, endSpeech",
          "edges": [
            "speech-bubble"
          ],
          "to": "display"
        },
        {
          "from": "speech",
          "label": "applyDirective per sentence, setMouthOpen by amplitude",
          "edges": [
            "speech-renderer"
          ],
          "to": "renderer"
        },
        {
          "from": "display",
          "label": "reads the bubble",
          "edges": [
            "bubble-user",
            "chips-user"
          ],
          "to": "user"
        },
        {
          "from": "speech",
          "label": "hears the voice",
          "edges": [
            "voice-user"
          ],
          "to": "user"
        },
        {
          "from": "renderer",
          "label": "sees the expression and the mouth move",
          "edges": [
            "character-user"
          ],
          "to": "user"
        },
        {
          "from": "backend-call",
          "label": "Records the turn: transcript, context history, turn-record log",
          "edges": [
            "backend-record",
            "backend-turn-record"
          ]
        },
        {
          "from": "turn",
          "label": "assistant transcript entry and render record of a rendered reply",
          "edges": [
            "render-conversation",
            "render-record"
          ],
          "to": "conversation",
          "transport": "push"
        },
        {
          "from": "speech",
          "label": "audio owed cleared: the turn is over",
          "edges": [
            "speech-ledger"
          ],
          "to": "turn"
        },
        {
          "from": "speech",
          "label": "how the utterance ended, kept for the next turn",
          "edges": [
            "speech-previous"
          ],
          "to": "backend-call"
        },
        {
          "from": "backend-call",
          "label": "playback frame for a turn that failed before speaking",
          "edges": [
            "previous-playback"
          ],
          "to": "transport",
          "transport": "push"
        }
      ]
    },
    {
      "id": "backend-turn",
      "title": "A backend-started turn",
      "steps": [
        {
          "from": "backend",
          "label": "speech or render frame with a turn id the client never opened",
          "edges": [
            "push-ws-in"
          ],
          "to": "transport",
          "transport": "push"
        },
        {
          "from": "transport",
          "label": "render-turn takes it under the backend event name",
          "edges": [
            "push-render"
          ],
          "to": "turn",
          "transport": "push"
        },
        {
          "from": "turn",
          "label": "The bus, the gates, the ledger, and the context builder take no part",
          "edges": [],
          "transport": "push"
        },
        {
          "from": "turn",
          "label": "TurnOutput: cueWithSpeech, delta, end, queued behind current speech",
          "edges": [
            "render-output",
            "output-speech"
          ],
          "to": "speech",
          "transport": "push"
        },
        {
          "from": "speech",
          "label": "Segments sentences and synthesizes each one through the TTS service",
          "edges": [
            "tts-http"
          ],
          "transport": "push"
        },
        {
          "from": "speech",
          "label": "beginSpeech, pushSpeech, endSpeech",
          "edges": [
            "speech-bubble"
          ],
          "to": "display",
          "transport": "push"
        },
        {
          "from": "speech",
          "label": "applyDirective per sentence, setMouthOpen by amplitude",
          "edges": [
            "speech-renderer"
          ],
          "to": "renderer",
          "transport": "push"
        },
        {
          "from": "display",
          "label": "reads the bubble",
          "edges": [
            "bubble-user"
          ],
          "to": "user",
          "transport": "push"
        },
        {
          "from": "speech",
          "label": "hears the voice",
          "edges": [
            "voice-user"
          ],
          "to": "user",
          "transport": "push"
        },
        {
          "from": "renderer",
          "label": "sees the expression and the mouth move",
          "edges": [
            "character-user"
          ],
          "to": "user",
          "transport": "push"
        },
        {
          "from": "turn",
          "label": "assistant transcript entry, render record",
          "edges": [
            "render-conversation",
            "render-record"
          ],
          "to": "conversation",
          "transport": "push"
        }
      ]
    },
    {
      "id": "tool-call",
      "title": "A tool call and an avatar command",
      "steps": [
        {
          "from": "tools",
          "label": "tool schemas rebuilt from the vocabulary for the turn",
          "edges": [
            "tools-backend"
          ],
          "to": "backend-call",
          "transport": "request"
        },
        {
          "from": "tools",
          "label": "hello.tools and hello.vocabulary; expression arrives as cues on reply segments",
          "edges": [
            "tools-push",
            "vocabulary-push"
          ],
          "to": "transport",
          "transport": "push"
        },
        {
          "from": "backend",
          "label": "function call in the stream, or a tool_call frame",
          "edges": [
            "stream-http",
            "push-ws-in"
          ],
          "to": "transport"
        },
        {
          "from": "transport",
          "label": "executeClientTool(tool, args)",
          "edges": [
            "stream-tools",
            "push-tools"
          ],
          "to": "tools"
        },
        {
          "from": "tools",
          "label": "rate_relation moves this preset's relation; the daily cap and the range clamp it",
          "edges": [
            "relations-tool"
          ],
          "to": "settings"
        },
        {
          "from": "settings",
          "label": "the next turn carries the relation line",
          "edges": [
            "relations-context"
          ],
          "to": "backend-call"
        },
        {
          "from": "tools",
          "label": "body_action and look reach the avatar executor",
          "edges": [
            "tools-executor"
          ]
        },
        {
          "from": "tools",
          "label": "look at screen: capture_screen_at",
          "edges": [
            "tools-capture",
            "capture-shell"
          ],
          "to": "shell"
        },
        {
          "from": "senders",
          "label": "GET /avatar/state, POST /avatar/command",
          "edges": [
            "avatar-ingress"
          ],
          "to": "shell"
        },
        {
          "from": "senders",
          "label": "GET or PUT /relations",
          "edges": [
            "relations-ingress"
          ],
          "to": "shell"
        },
        {
          "from": "shell",
          "label": "avatar-rpc event, answered on avatar_rpc_response",
          "edges": [
            "ingress-inbox",
            "inbox-rpc-response"
          ],
          "to": "tools"
        },
        {
          "from": "tools",
          "label": "relations_get reads the store; relations_put replaces it",
          "edges": [
            "relations-rpc"
          ],
          "to": "settings"
        },
        {
          "from": "tools",
          "label": "cancel the movers; bed lieDown, getUp",
          "edges": [
            "executor-locomotion",
            "executor-bed"
          ],
          "to": "ambient"
        },
        {
          "from": "tools",
          "label": "perch.placeOn, perch.release",
          "edges": [
            "executor-perch"
          ],
          "to": "sources"
        },
        {
          "from": "sources",
          "label": "user.window_sit_drop or user.peek_drop, without the gesture cue",
          "edges": [
            "gesture-bus"
          ],
          "to": "dispatcher"
        },
        {
          "from": "dispatcher",
          "label": "tier 1: posture directive, perch or peek pin",
          "edges": [
            "dispatcher-tier1",
            "tier1-renderer"
          ],
          "to": "renderer"
        },
        {
          "from": "dispatcher",
          "label": "peek.enter(), peek.exit()",
          "edges": [
            "tier1-peek"
          ],
          "to": "window"
        },
        {
          "from": "tools",
          "label": "ClientToolResult as function_call_output or a tool_result frame",
          "edges": [
            "stream-tools",
            "push-tools",
            "push-image"
          ],
          "to": "transport"
        },
        {
          "from": "transport",
          "label": "tool result",
          "edges": [
            "stream-http",
            "push-ws"
          ],
          "to": "backend"
        }
      ]
    },
    {
      "id": "stop",
      "title": "Stop",
      "steps": [
        {
          "from": "user",
          "label": "presses stop",
          "edges": [
            "user-input"
          ],
          "to": "input"
        },
        {
          "from": "input",
          "label": "stop handler",
          "edges": [
            "input-submit"
          ],
          "to": "display"
        },
        {
          "from": "display",
          "label": "stopTurn: dispatcher.cancel()",
          "edges": [
            "stop-dispatcher"
          ],
          "to": "dispatcher"
        },
        {
          "from": "dispatcher",
          "label": "abort the call in flight, drop pending",
          "edges": [
            "user-supersede"
          ],
          "to": "backend-call"
        },
        {
          "from": "display",
          "label": "pushTurns.cut(): open push turn ids move to stopped",
          "edges": [
            "stop-push-turns"
          ],
          "to": "turn",
          "transport": "push"
        },
        {
          "from": "display",
          "label": "speechPlayback.interrupt()",
          "edges": [
            "stop-speech"
          ],
          "to": "speech"
        },
        {
          "from": "speech",
          "label": "utterance ended interrupted, with the spoken split",
          "edges": [
            "speech-previous"
          ],
          "to": "backend-call"
        },
        {
          "from": "display",
          "label": "sendStop(turnIds)",
          "edges": [
            "stop-push"
          ],
          "to": "transport",
          "transport": "push"
        },
        {
          "from": "transport",
          "label": "stop frame",
          "edges": [
            "push-ws"
          ],
          "to": "backend",
          "transport": "push"
        },
        {
          "from": "dispatcher",
          "label": "A new user turn reaches the same end: it aborts the call in flight before its own call starts",
          "edges": [
            "user-supersede"
          ]
        },
        {
          "from": "input",
          "label": "barge-in: speech into the microphone interrupts playback",
          "edges": [
            "barge-in-speech"
          ],
          "to": "speech"
        },
        {
          "from": "input",
          "label": "barge-in cuts push turns",
          "edges": [
            "barge-in-push"
          ],
          "to": "turn",
          "transport": "push"
        }
      ]
    },
    {
      "id": "firing",
      "title": "Firing and classification of a speech candidate",
      "steps": [
        {
          "from": "shell",
          "label": "os_event: idle time and frontmost app, every 5 s",
          "edges": [
            "os-event"
          ],
          "to": "window"
        },
        {
          "from": "window",
          "label": "idle and frontmost samples",
          "edges": [
            "os-idle-tick",
            "os-presence"
          ],
          "to": "sources"
        },
        {
          "from": "sources",
          "label": "Proactive, schedule, milestone, and screen sources fire from the sample and their settings",
          "edges": [
            "settings-idle-tick"
          ]
        },
        {
          "from": "senders",
          "label": "POST /signals",
          "edges": [
            "agent-hooks-signals",
            "signals-ingress",
            "factorio-ingress"
          ],
          "to": "shell"
        },
        {
          "from": "shell",
          "label": "signals-inbox events",
          "edges": [
            "ingress-inbox"
          ],
          "to": "tools"
        },
        {
          "from": "tools",
          "label": "signal events",
          "edges": [
            "inbox-sources"
          ],
          "to": "sources"
        },
        {
          "from": "dispatcher",
          "label": "pacer gap and busy state hold inbox delivery",
          "edges": [
            "pacer-inbox",
            "busy-inbox-urgent"
          ],
          "to": "sources"
        },
        {
          "from": "user",
          "label": "taps, pats, drags",
          "edges": [
            "user-window"
          ],
          "to": "window"
        },
        {
          "from": "window",
          "label": "click, pat, and drag callbacks",
          "edges": [
            "pet-gestures"
          ],
          "to": "sources"
        },
        {
          "from": "ambient",
          "label": "waking from the bed fires the wake source",
          "edges": [
            "bed-wake"
          ],
          "to": "sources"
        },
        {
          "from": "sources",
          "label": "candidate envelopes on the bus",
          "edges": [
            "idle-tick-bus",
            "inbox-bus",
            "gesture-bus",
            "wake-bus"
          ],
          "to": "dispatcher"
        },
        {
          "from": "ambient",
          "label": "avatar.* movement events",
          "edges": [
            "locomotion-bus",
            "bed-bus"
          ],
          "to": "dispatcher"
        },
        {
          "from": "window",
          "label": "user.drag_start, user.drag_end",
          "edges": [
            "pet-drag-bus"
          ],
          "to": "dispatcher"
        },
        {
          "from": "dispatcher",
          "label": "Classifies each envelope as tier 1 or tier 2; tier 2 passes the pacer gap and the guardrails",
          "edges": [
            "bus-dispatcher"
          ]
        },
        {
          "from": "dispatcher",
          "label": "tier 1: local directive, posture, pins",
          "edges": [
            "dispatcher-tier1",
            "tier1-renderer"
          ],
          "to": "renderer"
        },
        {
          "from": "dispatcher",
          "label": "tier 2: the backend judges whether and what to speak",
          "edges": [
            "dispatcher-backend"
          ],
          "to": "backend-call"
        },
        {
          "from": "sources",
          "label": "skip record of a screen fire the pacer held",
          "edges": [
            "screen-skip-record"
          ],
          "to": "conversation"
        }
      ]
    },
    {
      "id": "settings",
      "title": "Settings propagation",
      "steps": [
        {
          "from": "user",
          "label": "edits a control",
          "edges": [
            "user-settings"
          ],
          "to": "settings"
        },
        {
          "from": "settings",
          "label": "The store commits and saves to localStorage",
          "edges": [
            "controls-settings"
          ]
        },
        {
          "from": "settings",
          "label": "settings-changed signal after 200 ms",
          "edges": [
            "settings-broadcast"
          ],
          "to": "bridge"
        },
        {
          "from": "bridge",
          "label": "each other window reloads its stores from localStorage",
          "edges": [
            "settings-reload"
          ],
          "to": "settings"
        },
        {
          "from": "settings",
          "label": "subscribed: endpoint or key change reopens the push socket",
          "edges": [
            "settings-push"
          ],
          "to": "transport",
          "transport": "push"
        },
        {
          "from": "settings",
          "label": "subscribed: guardrail caps, pacer gap",
          "edges": [
            "settings-guardrails",
            "settings-pacer"
          ],
          "to": "dispatcher"
        },
        {
          "from": "settings",
          "label": "subscribed: camera, idle motions",
          "edges": [
            "settings-camera",
            "settings-idle-motion"
          ],
          "to": "renderer"
        },
        {
          "from": "settings",
          "label": "subscribed: express-motion selection announces the vocabulary",
          "edges": [
            "vocabulary-settings",
            "vocabulary-derive"
          ],
          "to": "tools"
        },
        {
          "from": "settings",
          "label": "read per turn: endpoints, agent and screenshot settings",
          "edges": [
            "context-settings",
            "context-endpoints"
          ],
          "to": "backend-call"
        },
        {
          "from": "settings",
          "label": "read per utterance: TTS switch, speaker, lip-sync gain",
          "edges": [
            "settings-speech"
          ],
          "to": "speech"
        },
        {
          "from": "settings",
          "label": "read per segment: VAD silence, barge-in",
          "edges": [
            "settings-stt"
          ],
          "to": "input"
        },
        {
          "from": "settings",
          "label": "read per tick: cue lists, thresholds",
          "edges": [
            "settings-idle-tick",
            "settings-inbox"
          ],
          "to": "sources"
        },
        {
          "from": "settings",
          "label": "read once at boot: agent ingress switch and port",
          "edges": [
            "ingress-start"
          ],
          "to": "shell"
        },
        {
          "from": "settings",
          "label": "config hot reload: emotion registry, motions, avatar",
          "edges": [
            "config-renderer"
          ],
          "to": "renderer"
        },
        {
          "from": "settings",
          "label": "config hot reload: guardrails",
          "edges": [
            "config-guardrails"
          ],
          "to": "dispatcher"
        }
      ]
    }
  ],
  "windows": {
    "nodes": [
      {
        "id": "pet",
        "label": "pet",
        "role": "Runs the turn core and owns the renderer, the push socket, the delegations and reasoning stores, and the real voice state."
      },
      {
        "id": "pet-<id>",
        "label": "pet-<id>",
        "role": "A bound pet window, index.html?preset=<id>: one preset's stores, local surfaces, push socket, and delegations, which opens settings-<id> and message-<id> and keeps none of main's global resources."
      },
      {
        "id": "settings",
        "label": "settings",
        "role": "The settings panel as a window, over its own store instances and mirrors of the pet window's push state and delegations."
      },
      {
        "id": "settings-<id>",
        "label": "settings-<id>",
        "role": "The settings window of one bound pet window, settings.html?preset=<id>: the same panel over that preset's stores and mirrors of pet-<id>'s push state and delegations, with no voice switch, and an edit target like main's settings window."
      },
      {
        "id": "message",
        "label": "message",
        "role": "The speech bubble, text input, and plate popped out of the pet window, drawn from surface ops."
      },
      {
        "id": "message-<id>",
        "label": "message-<id>",
        "role": "The message window of one bound pet window, message.html?preset=<id>: the same bubble, input, and plate, drawn from pet-<id>'s surface ops."
      },
      {
        "id": "quick-card",
        "label": "quick-card",
        "role": "The quick card in its own frameless window, quick-card.html: the tiles and rows over that preset's stores, docked beside the character, placed and moved by the dock, hidden on close."
      },
      {
        "id": "quick-card-<id>",
        "label": "quick-card-<id>",
        "role": "The quick-card window of one bound pet window, quick-card.html?preset=<id>: the same card over that preset's stores."
      },
      {
        "id": "unified",
        "label": "unified",
        "role": "The unified chat window, unified.html: a frameless 340 px column that is the only chat path while it shows; the cast chips, one dialogue box showing one character's line at a time, and the composer that routes a message to one preset or, in sequence, to all"
      },
      {
        "id": "devtools",
        "label": "devtools",
        "role": "Context inspector, advanced settings, and motion preview over reloaded stores."
      },
      {
        "id": "ingress",
        "label": "agent ingress",
        "role": "The loopback HTTP listener in the main process, one port for every window: it chooses the recipient by path."
      }
    ],
    "edges": [
      {
        "id": "settings-changed-settings",
        "from": "settings",
        "to": "pet",
        "carries": "yui://settings-changed: reload stores from localStorage",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-pet",
        "from": "pet",
        "to": "settings",
        "carries": "yui://settings-changed",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-devtools",
        "from": "devtools",
        "to": "pet",
        "carries": "yui://settings-changed",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-to-devtools",
        "from": "pet",
        "to": "devtools",
        "carries": "yui://settings-changed: reload stores and context history",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-message",
        "from": "pet",
        "to": "message",
        "carries": "yui://settings-changed: reload locale, bubble persistence, mirrors",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-settings-companion",
        "from": "settings-<id>",
        "to": "pet-<id>",
        "carries": "yui://settings-changed: reload stores from localStorage",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-pet-companion",
        "from": "pet-<id>",
        "to": "settings-<id>",
        "carries": "yui://settings-changed",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-message-companion",
        "from": "pet-<id>",
        "to": "message-<id>",
        "carries": "yui://settings-changed: reload locale, bubble persistence, mirrors",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-settings",
        "from": "settings",
        "to": "pet",
        "carries": "yui://preset-changed {active}: reread the registry; another active preset stops the turn and reloads; a bound pet window keeps its preset and does not reload",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-pet",
        "from": "pet",
        "to": "settings",
        "carries": "yui://preset-changed {active}: reread the registry; another active preset reloads; a bound pet window emits it too and never reloads on it",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-settings-bound",
        "from": "settings",
        "to": "pet-<id>",
        "carries": "yui://preset-changed {active}: reread the registry; no reload",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-pet-bound",
        "from": "pet",
        "to": "pet-<id>",
        "carries": "yui://preset-changed {active}: reread the registry; no reload",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-settings-pet-companion",
        "from": "settings-<id>",
        "to": "pet-<id>",
        "carries": "yui://preset-changed {active}: reread the registry; no reload",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-pet-settings-companion",
        "from": "pet-<id>",
        "to": "settings-<id>",
        "carries": "yui://preset-changed {active}: reread the registry; no reload",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-pet-message-companion",
        "from": "pet-<id>",
        "to": "message-<id>",
        "carries": "yui://preset-changed {active}: reread the registry; no reload",
        "kind": "bridge"
      },
      {
        "id": "quick-card-open-pet",
        "from": "pet",
        "to": "quick-card",
        "carries": "yui://quick-card-open {left, right, y, listening?}: seed the Listen tile, place the window docked, show and focus",
        "kind": "bridge"
      },
      {
        "id": "quick-card-ready-card",
        "from": "quick-card",
        "to": "pet",
        "carries": "yui://quick-card-ready: the controller sends a request it held since the create",
        "kind": "bridge"
      },
      {
        "id": "quick-card-open-bound",
        "from": "pet-<id>",
        "to": "quick-card-<id>",
        "carries": "yui://quick-card-open {left, right, y}: seed nothing and place the window docked, show and focus",
        "kind": "bridge"
      },
      {
        "id": "quick-card-ready-bound",
        "from": "quick-card-<id>",
        "to": "pet-<id>",
        "carries": "yui://quick-card-ready: the controller sends a request it held since the create",
        "kind": "bridge"
      },
      {
        "id": "quick-card-owner-move",
        "from": "pet",
        "to": "quick-card",
        "carries": "the owner window's tauri://move: on macOS AppKit moves the linked child card with her and the dock only switches sides; elsewhere a docked card moves by her delta",
        "kind": "tauri-event"
      },
      {
        "id": "quick-card-owner-move-bound",
        "from": "pet-<id>",
        "to": "quick-card-<id>",
        "carries": "the owner window's tauri://move: on macOS AppKit moves the linked child card with her and the dock only switches sides; elsewhere a docked card moves by her delta",
        "kind": "tauri-event"
      },
      {
        "id": "settings-changed-quick-card",
        "from": "quick-card",
        "to": "pet",
        "carries": "yui://settings-changed: reload stores from localStorage (a tile, Body, Reference voice)",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-to-quick-card",
        "from": "pet",
        "to": "quick-card",
        "carries": "yui://settings-changed",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-quick-card-bound",
        "from": "quick-card-<id>",
        "to": "pet-<id>",
        "carries": "yui://settings-changed: reload stores from localStorage (a tile, Body, Reference voice)",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-to-quick-card-bound",
        "from": "pet-<id>",
        "to": "quick-card-<id>",
        "carries": "yui://settings-changed",
        "kind": "bridge"
      },
      {
        "id": "voice-set-quick-card",
        "from": "quick-card",
        "to": "pet",
        "carries": "yui://voice-set: boolean, the Listen tile; main only",
        "kind": "bridge"
      },
      {
        "id": "voice-state-quick-card",
        "from": "pet",
        "to": "quick-card",
        "carries": "yui://voice-state: {state}, mirrored on the Listen tile; main only",
        "kind": "bridge"
      },
      {
        "id": "session-reset-quick-card",
        "from": "quick-card",
        "to": "pet",
        "carries": "yui://session-reset: {presetId}; the pet window stops its reply and greets",
        "kind": "bridge"
      },
      {
        "id": "session-reset-quick-card-bound",
        "from": "quick-card-<id>",
        "to": "pet-<id>",
        "carries": "yui://session-reset: {presetId}; the pet window stops its reply and greets",
        "kind": "bridge"
      },
      {
        "id": "push-reset-quick-card",
        "from": "quick-card",
        "to": "pet",
        "carries": "yui://push-reset: Reset conversation on push; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "push-reset-quick-card-bound",
        "from": "quick-card-<id>",
        "to": "pet-<id>",
        "carries": "yui://push-reset: Reset conversation on push; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "push-state-quick-card",
        "from": "pet",
        "to": "quick-card",
        "carries": "yui://push-state, answered on yui://push-state-ask; the head's transport line",
        "kind": "bridge"
      },
      {
        "id": "push-state-quick-card-bound",
        "from": "pet-<id>",
        "to": "quick-card-<id>",
        "carries": "yui://push-state, answered on yui://push-state-ask; the head's transport line",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-quick-card-bound",
        "from": "quick-card-<id>",
        "to": "pet",
        "carries": "yui://pet-windows-changed: Turn off; main reconciles and closes pet-<id>",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-to-quick-card",
        "from": "pet",
        "to": "quick-card",
        "carries": "yui://pet-windows-changed: reload yui.windows",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-pet-quick-card",
        "from": "pet",
        "to": "quick-card",
        "carries": "yui://preset-changed {active}: another active preset reloads",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-settings-quick-card",
        "from": "settings",
        "to": "quick-card",
        "carries": "yui://preset-changed {active}: another active preset reloads",
        "kind": "bridge"
      },
      {
        "id": "settings-page-quick-card",
        "from": "quick-card",
        "to": "settings",
        "carries": "yui://settings-page: {preset}; All settings… on an open settings window",
        "kind": "bridge"
      },
      {
        "id": "settings-page-quick-card-bound",
        "from": "quick-card-<id>",
        "to": "settings-<id>",
        "carries": "yui://settings-page: {preset}; All settings… on an open settings window",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-settings",
        "from": "settings",
        "to": "pet",
        "carries": "yui://pet-windows-changed: reload yui.windows and the live keys",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-pet",
        "from": "pet",
        "to": "settings",
        "carries": "yui://pet-windows-changed",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-settings-bound",
        "from": "settings",
        "to": "pet-<id>",
        "carries": "yui://pet-windows-changed: reload yui.windows and the live keys",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-bound-settings",
        "from": "pet-<id>",
        "to": "settings",
        "carries": "yui://pet-windows-changed",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-pet-bound",
        "from": "pet",
        "to": "pet-<id>",
        "carries": "yui://pet-windows-changed: reload yui.windows and the live keys",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-bound-pet",
        "from": "pet-<id>",
        "to": "pet",
        "carries": "yui://pet-windows-changed",
        "kind": "bridge"
      },
      {
        "id": "voice-lock-pet-bound",
        "from": "pet",
        "to": "pet-<id>",
        "carries": "navigator.locks yui.speaking: taken before an utterance's first sentence plays while yui.one-voice is on, released at the utterance's end or when the window dies; other windows queue in order",
        "kind": "storage"
      },
      {
        "id": "voice-lock-bound-pet",
        "from": "pet-<id>",
        "to": "pet",
        "carries": "navigator.locks yui.speaking",
        "kind": "storage"
      },
      {
        "id": "turn-lock-pet-bound",
        "from": "pet",
        "to": "pet-<id>",
        "carries": "navigator.locks yui.turn: taken before a turn's backend call while yui.one-voice is on, released when the pipeline is idle (call ended and playback done) or when the window dies; other windows queue in order",
        "kind": "storage"
      },
      {
        "id": "turn-lock-bound-pet",
        "from": "pet-<id>",
        "to": "pet",
        "carries": "navigator.locks yui.turn",
        "kind": "storage"
      },
      {
        "id": "pet-windows-changed-settings-companion",
        "from": "settings-<id>",
        "to": "pet-<id>",
        "carries": "yui://pet-windows-changed: reload yui.windows and the live keys",
        "kind": "bridge"
      },
      {
        "id": "pet-windows-changed-pet-companion",
        "from": "pet-<id>",
        "to": "settings-<id>",
        "carries": "yui://pet-windows-changed",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-pet-message",
        "from": "pet",
        "to": "message",
        "carries": "yui://preset-changed {active}: another active preset reloads",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-settings-message",
        "from": "settings",
        "to": "message",
        "carries": "yui://preset-changed {active}: another active preset reloads",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-pet-devtools",
        "from": "pet",
        "to": "devtools",
        "carries": "yui://preset-changed {active}: another active preset reloads",
        "kind": "bridge"
      },
      {
        "id": "preset-changed-settings-devtools",
        "from": "settings",
        "to": "devtools",
        "carries": "yui://preset-changed {active}: another active preset reloads",
        "kind": "bridge"
      },
      {
        "id": "mouth-preview",
        "from": "settings",
        "to": "pet",
        "carries": "yui://mouth-preview: number or null; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "mouth-preview-companion",
        "from": "settings-<id>",
        "to": "pet-<id>",
        "carries": "yui://mouth-preview: number or null; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "voice-set",
        "from": "settings",
        "to": "pet",
        "carries": "yui://voice-set: boolean; unscoped: main is the only handler, so main's settings window keeps the toggle while it edits another preset",
        "kind": "bridge"
      },
      {
        "id": "voice-state",
        "from": "pet",
        "to": "settings",
        "carries": "yui://voice-state: {state}; unscoped: main is the only handler, so main's settings window keeps the toggle while it edits another preset",
        "kind": "bridge"
      },
      {
        "id": "help-guide",
        "from": "settings",
        "to": "pet",
        "carries": "yui://help-guide: {guide, text}",
        "kind": "bridge"
      },
      {
        "id": "settings-page-window",
        "from": "pet",
        "to": "settings",
        "carries": "yui://settings-page: {preset, page?}; unscoped, the settings window of that preset acts on it",
        "kind": "bridge"
      },
      {
        "id": "open-devtools-window",
        "from": "settings",
        "to": "pet",
        "carries": "yui://open-devtools: no payload; unscoped, only main's pet window opens the devtools window",
        "kind": "bridge"
      },
      {
        "id": "open-devtools-companion",
        "from": "settings-<id>",
        "to": "pet",
        "carries": "yui://open-devtools: no payload; unscoped, only main's pet window opens the devtools window",
        "kind": "bridge"
      },
      {
        "id": "settings-page-companion",
        "from": "pet-<id>",
        "to": "settings-<id>",
        "carries": "yui://settings-page: {preset, page?}; unscoped, the settings window of that preset acts on it",
        "kind": "bridge"
      },
      {
        "id": "help-guide-companion",
        "from": "settings-<id>",
        "to": "pet-<id>",
        "carries": "yui://help-guide: {guide, text}",
        "kind": "bridge"
      },
      {
        "id": "push-state-settings",
        "from": "pet",
        "to": "settings",
        "carries": "yui://push-state, answered on yui://push-state-ask; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "push-state-settings-companion",
        "from": "pet-<id>",
        "to": "settings-<id>",
        "carries": "yui://push-state, answered on yui://push-state-ask; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "push-state-message",
        "from": "pet",
        "to": "message",
        "carries": "yui://push-state, answered on yui://push-state-ask; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "push-state-message-companion",
        "from": "pet-<id>",
        "to": "message-<id>",
        "carries": "yui://push-state, answered on yui://push-state-ask; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "session-reset",
        "from": "settings",
        "to": "pet",
        "carries": "yui://session-reset: {presetId}; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "session-reset-companion",
        "from": "settings-<id>",
        "to": "pet-<id>",
        "carries": "yui://session-reset: {presetId}; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "push-reset",
        "from": "settings",
        "to": "pet",
        "carries": "yui://push-reset, yui://push-reconnect; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "push-reset-companion",
        "from": "settings-<id>",
        "to": "pet-<id>",
        "carries": "yui://push-reset, yui://push-reconnect; filtered by preset id",
        "kind": "bridge"
      },
      {
        "id": "delegations-settings",
        "from": "pet",
        "to": "settings",
        "carries": "yui://delegations, answered on yui://delegations-ask",
        "kind": "bridge"
      },
      {
        "id": "delegations-settings-companion",
        "from": "pet-<id>",
        "to": "settings-<id>",
        "carries": "yui://delegations, answered on yui://delegations-ask",
        "kind": "bridge"
      },
      {
        "id": "delegations-message",
        "from": "pet",
        "to": "message",
        "carries": "yui://delegations, answered on yui://delegations-ask",
        "kind": "bridge"
      },
      {
        "id": "delegations-message-companion",
        "from": "pet-<id>",
        "to": "message-<id>",
        "carries": "yui://delegations, answered on yui://delegations-ask",
        "kind": "bridge"
      },
      {
        "id": "reasoning-message",
        "from": "pet",
        "to": "message",
        "carries": "yui://reasoning, answered on yui://reasoning-ask",
        "kind": "bridge"
      },
      {
        "id": "reasoning-message-companion",
        "from": "pet-<id>",
        "to": "message-<id>",
        "carries": "yui://reasoning, answered on yui://reasoning-ask",
        "kind": "bridge"
      },
      {
        "id": "message-surface",
        "from": "pet",
        "to": "message",
        "carries": "yui://message-surface: MessageSurfaceOp",
        "kind": "bridge"
      },
      {
        "id": "message-surface-companion",
        "from": "pet-<id>",
        "to": "message-<id>",
        "carries": "yui://message-surface: MessageSurfaceOp",
        "kind": "bridge"
      },
      {
        "id": "message-control",
        "from": "message",
        "to": "pet",
        "carries": "yui://message-control: submit, stop, input-open, input-error-action, speech-action, dock, open-settings, ready",
        "kind": "bridge"
      },
      {
        "id": "message-control-companion",
        "from": "message-<id>",
        "to": "pet-<id>",
        "carries": "yui://message-control: submit, stop, input-open, input-error-action, speech-action, dock, open-settings, ready",
        "kind": "bridge"
      },
      {
        "id": "ingress-inbox-pet",
        "from": "ingress",
        "to": "pet",
        "carries": "bare /signals and /avatar/* → signals-inbox, avatar-rpc, ingress-dead",
        "kind": "tauri-event"
      },
      {
        "id": "ingress-inbox-pet-bound",
        "from": "ingress",
        "to": "pet-<id>",
        "carries": "/presets/<id>/signals and /presets/<id>/avatar/* → signals-inbox, avatar-rpc, to the window bound to <id> and no other",
        "kind": "tauri-event"
      },
      {
        "id": "character-addressed-pet-bound",
        "from": "pet",
        "to": "pet-<id>",
        "carries": "yui://character-addressed {from, name, to, text, ts, user_message?}; unscoped: every pet window receives it and keeps the one naming its preset",
        "kind": "bridge"
      },
      {
        "id": "speech-stream-pet-unified",
        "from": "pet",
        "to": "unified",
        "carries": "yui://speech-stream {preset, op}: the message-window ops of the pet's lines, quotes, summons and input errors while the unified chat window shows; busy and name always",
        "kind": "bridge"
      },
      {
        "id": "speech-stream-pet-bound-unified",
        "from": "pet-<id>",
        "to": "unified",
        "carries": "yui://speech-stream {preset, op}: the message-window ops of the pet's lines, quotes, summons and input errors while the unified chat window shows; busy and name always",
        "kind": "bridge"
      },
      {
        "id": "user-turn-routed-unified-pet",
        "from": "unified",
        "to": "pet",
        "carries": "yui://user-turn-routed {sendId, to, text, mention?, via?}; unscoped: every pet window receives it and keeps the one naming its preset",
        "kind": "bridge"
      },
      {
        "id": "user-turn-routed-unified-pet-bound",
        "from": "unified",
        "to": "pet-<id>",
        "carries": "yui://user-turn-routed {sendId, to, text, mention?, via?}; unscoped: every pet window receives it and keeps the one naming its preset",
        "kind": "bridge"
      },
      {
        "id": "user-turn-done-pet-unified",
        "from": "pet",
        "to": "unified",
        "carries": "yui://user-turn-done {sendId, preset}",
        "kind": "bridge"
      },
      {
        "id": "user-turn-done-pet-bound-unified",
        "from": "pet-<id>",
        "to": "unified",
        "carries": "yui://user-turn-done {sendId, preset}",
        "kind": "bridge"
      },
      {
        "id": "settings-changed-pet-unified",
        "from": "pet",
        "to": "unified",
        "carries": "yui://settings-changed, preset-changed and pet-windows-changed: the unified chat window re-reads the open presets' transcripts",
        "kind": "bridge"
      },
      {
        "id": "speech-stream-ask-unified-pet",
        "from": "unified",
        "to": "pet",
        "carries": "yui://speech-stream-ask: the pet's stream half restates its name and busy state",
        "kind": "bridge"
      },
      {
        "id": "speech-stream-ask-unified-pet-bound",
        "from": "unified",
        "to": "pet-<id>",
        "carries": "yui://speech-stream-ask: the pet's stream half restates its name and busy state",
        "kind": "bridge"
      },
      {
        "id": "speech-stream-control-unified-pet",
        "from": "unified",
        "to": "pet",
        "carries": "yui://speech-stream-control {preset, op: input-error-action}: the pet whose preset it names runs the error's fix",
        "kind": "bridge"
      },
      {
        "id": "speech-stream-control-unified-pet-bound",
        "from": "unified",
        "to": "pet-<id>",
        "carries": "yui://speech-stream-control {preset, op: input-error-action}: the pet whose preset it names runs the error's fix",
        "kind": "bridge"
      },
      {
        "id": "stop-turns-unified-pet",
        "from": "unified",
        "to": "pet",
        "carries": "yui://stop-turns from the stop button or a speech-onset answer: the pet window stops its running turn and speech",
        "kind": "bridge"
      },
      {
        "id": "stop-turns-unified-pet-bound",
        "from": "unified",
        "to": "pet-<id>",
        "carries": "yui://stop-turns from the stop button or a speech-onset answer: the pet window stops its running turn and speech",
        "kind": "bridge"
      },
      {
        "id": "voice-segment-pet-unified",
        "from": "pet",
        "to": "unified",
        "carries": "yui://voice-segment {text}: main's recognized speech while the unified chat window shows",
        "kind": "bridge"
      },
      {
        "id": "speech-onset-pet-unified",
        "from": "pet",
        "to": "unified",
        "carries": "yui://speech-onset when the user starts speaking with barge-in on: the unified chat window answers like its stop button while a character runs",
        "kind": "bridge"
      },
      {
        "id": "unified-open-pet",
        "from": "pet",
        "to": "unified",
        "carries": "WebviewWindow unified: created at its stored position or shown and focused while the unified chat window shows, destroyed otherwise",
        "kind": "tauri-command"
      },
      {
        "id": "character-addressed-bound-pet",
        "from": "pet-<id>",
        "to": "pet",
        "carries": "yui://character-addressed {from, name, to, text, ts, user_message?}; unscoped: every pet window receives it and keeps the one naming its preset",
        "kind": "bridge"
      }
    ]
  }
}
