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
      "desc": "Mods/avatar, coding-agent hooks, signal producers, the verification driver"
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
      "desc": "Event bus, tier classification, guardrails, pacer, tier-1 reactions",
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
      "desc": "Judges whether and what to speak; Expression Broker"
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
      "label": "agent events, signals, avatar commands, WebDriver session (verify feature)"
    },
    {
      "from": "shell",
      "to": "tools",
      "label": "agent, signal, avatar-rpc events"
    },
    {
      "from": "tools",
      "to": "sources",
      "label": "agent and signal events"
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
      "role": "The person at the desktop or the phone.",
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
      "id": "expression-broker",
      "module": "backend",
      "label": "Expression Broker",
      "role": "The MCP server the client publishes its express vocabulary to.",
      "paths": [],
      "external": true
    },
    {
      "id": "mods-avatar",
      "module": "senders",
      "label": "Mods/avatar",
      "role": "The MCP server that reads body state and sends body commands over the loopback avatar endpoints.",
      "paths": [],
      "external": true
    },
    {
      "id": "agent-hooks",
      "module": "senders",
      "label": "coding-agent hooks",
      "role": "Lifecycle hooks of external coding agents that post done and needs-input events.",
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
      "role": "Loopback HTTP listener for agent events, signals, and the avatar RPC round trip.",
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
      "id": "shell/browser",
      "module": "shell",
      "label": "browser",
      "role": "Launches and owns a dedicated-profile Chrome over loopback CDP, runs one browser action at a time under a generation and a deadline, keeps the current ref table, and stops only the Chrome it started.",
      "paths": [
        "src-tauri/src/browser"
      ]
    },
    {
      "id": "shell/window",
      "module": "shell",
      "label": "window control",
      "role": "OS-native window drag, logical window frames, and the click-through toggle.",
      "paths": [
        "src-tauri/src/drag.rs",
        "src-tauri/src/window_frame.rs",
        "src-tauri/src/passthrough.rs"
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
      "role": "Native copy of user-picked VRM, voice clip, and stage image files into app data.",
      "paths": [
        "src-tauri/src/import_fs.rs",
        "src-tauri/src/vrm_import.rs",
        "src-tauri/src/voice_import.rs",
        "src-tauri/src/stage_image.rs"
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
      "role": "Persisted user settings, one localStorage-backed store per setting.",
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
      "role": "The tools the client declares to the backend and runs itself: generate_express, body_action, look, browser.",
      "paths": [
        "src/io/chat/tools"
      ]
    },
    {
      "id": "io/browser",
      "module": "tools",
      "label": "browser shell adapter",
      "role": "Forwards a browser action to the shell under the generation it was accepted in, cancels accepted calls, and stops the owned Chrome when the switch turns off.",
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
      "id": "io/chat/broker",
      "module": "tools",
      "label": "broker client",
      "role": "Write-only Expression Broker client and its URL override reconciler.",
      "paths": [
        "src/io/chat/broker"
      ]
    },
    {
      "id": "io/chat/conversation",
      "module": "conversation",
      "label": "conversation stores",
      "role": "Transcript, context history, response-id session, and session diagnostics.",
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
      "role": "Sentence segmentation, synthesis, in-order playback, and the glue to the mouth and the bubble.",
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
      "role": "Monitor and floor math, the travel and stationary frames, and keep-on-screen.",
      "paths": [
        "src/io/window/geometry"
      ]
    },
    {
      "id": "io/window/openers",
      "module": "window",
      "label": "window openers",
      "role": "Opens and places the message, settings, and devtools windows.",
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
      "role": "The cross-window bus transport and the owner and mirror pattern built on it.",
      "paths": [
        "src/io/bridge/core"
      ]
    },
    {
      "id": "io/bridge/settings",
      "module": "bridge",
      "label": "settings bridge",
      "role": "Typed cross-window settings bus.",
      "paths": [
        "src/io/bridge/settings-bridge.ts"
      ]
    },
    {
      "id": "io/bridge/message",
      "module": "bridge",
      "label": "message bridge",
      "role": "The bus between the pet window and the message window, and the message window's surfaces as a remote half.",
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
      "role": "Subscriptions to the shell's agent, signals, and avatar RPC channels, and the avatar executor that answers body commands.",
      "paths": [
        "src/io/bridge/inbox"
      ]
    },
    {
      "id": "io/assets",
      "module": "settings",
      "label": "assets",
      "role": "VRM selection and import, and the phone stage background.",
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
      "id": "io/lifecycle",
      "module": "window",
      "label": "page lifecycle",
      "role": "The Android back-button claim and page visibility.",
      "paths": [
        "src/io/lifecycle"
      ]
    },
    {
      "id": "io/stage",
      "module": "input",
      "label": "stage pointer",
      "role": "Press travel and the touch gesture recognizer every stage surface shares.",
      "paths": [
        "src/io/stage"
      ]
    },
    {
      "id": "dispatcher",
      "module": "dispatcher",
      "label": "dispatcher",
      "role": "The router: pumps the bus, classifies each envelope, and runs one backend call at a time.",
      "paths": [
        "src/dispatcher"
      ]
    },
    {
      "id": "dispatcher/core",
      "module": "dispatcher",
      "label": "bus and gates",
      "role": "The event bus, tier classification, guardrails, and the proactive pacer.",
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
      "role": "Agent-lifecycle and signals firing sources with presence-gated buffering.",
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
      "role": "The speech bubble and text input as one system, and the router between the pet window and the message window.",
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
      "role": "The speech bubble, the quoted user line, the reasoning disclosure, and the message-window plate.",
      "paths": [
        "src/ui/message"
      ]
    },
    {
      "id": "ui/chips",
      "module": "display",
      "label": "chips",
      "role": "The status pill, which names a client-run tool's action, the delegation chip, and the voice-input status model.",
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
      "role": "The settings panel, shown as a popover in the pet window and as the whole settings window.",
      "paths": [
        "src/ui/quick-controls"
      ]
    },
    {
      "id": "ui/phone",
      "module": "display",
      "label": "phone ui",
      "role": "Phone-window layout, settings sheet, and stage backdrop.",
      "paths": [
        "src/ui/phone"
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
      "id": "app/bootstrap",
      "module": "wiring",
      "label": "pet bootstrap",
      "role": "The pet window's config-derived composition root and the shared teardown bag.",
      "paths": [
        "src/app"
      ]
    },
    {
      "id": "app/turn",
      "module": "wiring",
      "label": "turn wiring",
      "role": "Connects voice, dispatcher, sources, vocabulary, broker, and the push transport into the chat turn.",
      "paths": [
        "src/app/turn"
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
      "role": "Store bags, the config store with its live merges and reload, and avatar selection.",
      "paths": [
        "src/app/settings"
      ]
    },
    {
      "id": "app/controls",
      "module": "wiring",
      "label": "controls wiring",
      "role": "The pet window's quick-controls panel, context menu, and guide requests.",
      "paths": [
        "src/app/controls"
      ]
    },
    {
      "id": "app/message",
      "module": "wiring",
      "label": "message-window wiring",
      "role": "Draws surface ops from the pet window and binds the message window's drag, focus, and resize.",
      "paths": [
        "src/app/message"
      ]
    },
    {
      "id": "app/settings-window",
      "module": "wiring",
      "label": "settings-window wiring",
      "role": "Composes the settings window and mirrors the voice toggle.",
      "paths": [
        "src/app/settings-window"
      ]
    },
    {
      "id": "app/phone",
      "module": "wiring",
      "label": "phone wiring",
      "role": "The phone window's turn core, settings view, stage, top row, and voice controller.",
      "paths": [
        "src/app/phone"
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
      "carries": "onVoiceSegment(text) → submitVoice",
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
      "carries": "onTurnAdmitted → quoteUser, settleQuote, clearQuote",
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
      "carries": "previous response id, pending tool outputs, transcript entries after the last boundary",
      "kind": "callback",
      "transport": "request",
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
      "carries": "recordSentTurn: transcript entries, context history, response id; usage",
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
      "carries": "assistant transcript entry of a rendered reply",
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
      "carries": "speech bubble text, user quote, reasoning disclosure",
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
      "carries": "TurnFeed.onToolStatus {state, tool_id, action} → showTool, finishTool, hideTool",
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
      "carries": "createClientTools(vocabulary, avatarTools) per turn",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/wire-dispatcher.ts"
    },
    {
      "id": "tools-backend",
      "from": "io/chat/tools",
      "to": "dispatcher/backend",
      "carries": "declared tool schemas of the turn",
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
      "carries": "hello.tools: the avatar tools and browser",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/push-stores.ts"
    },
    {
      "id": "vocabulary-broker",
      "from": "io/chat/vocabulary",
      "to": "io/chat/broker",
      "carries": "publish(ExpressVocabulary) at boot and on each announce",
      "kind": "callback",
      "transport": "request",
      "wiring": "src/app/turn/broker/wire-broker.ts"
    },
    {
      "id": "broker-http",
      "from": "io/chat/broker",
      "to": "expression-broker",
      "carries": "MCP streamable-http publish of the vocabulary",
      "kind": "http",
      "transport": "request"
    },
    {
      "id": "stream-tools",
      "from": "io/chat/stream",
      "to": "io/chat/tools",
      "carries": "runClientCall → executeClientTool(tool, args, request signal) → ClientToolResult; tool_status with the call's action",
      "kind": "call",
      "transport": "request"
    },
    {
      "id": "push-tools",
      "from": "io/chat/push",
      "to": "io/chat/tools",
      "carries": "tool_call frame → executeClientTool(tool, args, signal aborted on the turn's cut, socket loss, reset, disposal) → tool_result frame",
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
      "carries": "browser → shell.run(action, fields, signal) → result string",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
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
      "id": "settings-browser",
      "from": "settings",
      "to": "io/browser",
      "carries": "browserSettings off → cancel, browser_stop",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/app/bootstrap-configured.ts"
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
      "carries": "browser_generation, browser_cancel, browser_run {gen, deadlineAt, action, args}, browser_stop",
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
      "id": "hooks-ingress",
      "from": "agent-hooks",
      "to": "shell/agent-ingress",
      "carries": "POST /agent-event {tool, project, phase, summary, …}",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "signals-ingress",
      "from": "signal-producers",
      "to": "shell/agent-ingress",
      "carries": "POST /signals {signals, envelope}",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "mods-ingress",
      "from": "mods-avatar",
      "to": "shell/agent-ingress",
      "carries": "GET /avatar/state, GET /avatar/perch-targets, POST /avatar/command; JSON answer",
      "kind": "http",
      "transport": "shared"
    },
    {
      "id": "ingress-inbox",
      "from": "shell/agent-ingress",
      "to": "io/bridge/inbox",
      "carries": "agent-inbox, signals-inbox, avatar-rpc, ingress-dead",
      "kind": "tauri-event",
      "transport": "shared"
    },
    {
      "id": "inbox-rpc-response",
      "from": "io/bridge/inbox",
      "to": "shell/agent-ingress",
      "carries": "avatar_rpc_response {id, result}",
      "kind": "tauri-command",
      "transport": "shared"
    },
    {
      "id": "ingress-start",
      "from": "settings",
      "to": "shell/agent-ingress",
      "carries": "start_agent_ingress {port} at boot when agent notifications are on",
      "kind": "tauri-command",
      "transport": "shared",
      "wiring": "src/app/stage/wire-window-sources.ts"
    },
    {
      "id": "inbox-sources",
      "from": "io/bridge/inbox",
      "to": "dispatcher/sources/inbox",
      "carries": "onAgentEvent(AgentEventPayload), onSignals(SignalsPayload)",
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
      "carries": "window_drop_release",
      "kind": "tauri-event",
      "transport": "shared"
    },
    {
      "id": "drop-release-source",
      "from": "shell/os-event-watcher",
      "to": "dispatcher/sources/gesture",
      "carries": "window_drop_release",
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
      "carries": "bus.push: agent.done, agent.needs_input, agent.catchup, signals.push, signals.batch, signals.catchup",
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
      "id": "pacer-inbox",
      "from": "dispatcher/core",
      "to": "dispatcher/sources/inbox",
      "carries": "composePacedPipelineBusy: pacer gap and dispatcher busy hold delivery",
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
      "carries": "tray_toggle → peek exit",
      "kind": "tauri-event",
      "transport": "shared",
      "wiring": "src/app/stage/wire-summon.ts"
    },
    {
      "id": "tray-message",
      "from": "shell/tray",
      "to": "io/window/openers",
      "carries": "tray_toggle → hide or reopen the message window",
      "kind": "tauri-event",
      "transport": "shared"
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
      "carries": "setFraming, setFitBand, setViewWindow",
      "kind": "call",
      "transport": "shared"
    },
    {
      "id": "controls-settings",
      "from": "ui/quick-controls",
      "to": "settings",
      "carries": "store commit → localStorage yui.*",
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
      "carries": "yui://settings-changed → reloadFromStorage on every broadcast store",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/app/cross-window/wire-window-sync.ts"
    },
    {
      "id": "settings-guardrails",
      "from": "settings",
      "to": "dispatcher/core",
      "carries": "guardrail caps → guardrails.setConfig(getGuardrails())",
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
      "carries": "import_vrm_file, remove_user_vrm, import_stage_image, remove_stage_image",
      "kind": "tauri-command",
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
      "carries": "read the model list for the Connection tab",
      "kind": "call",
      "transport": "request"
    },
    {
      "id": "controls-guide",
      "from": "ui/quick-controls",
      "to": "dispatcher/sources/user-input",
      "carries": "Ask press → submitGuide(guide, text)",
      "kind": "callback",
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
      "carries": "onSpeechActive with speech outstanding → speechPlayback.interrupt({muteCurrentTurn}), fillerLoop.stop()",
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
      "carries": "publishPushSocket: PushSocketState",
      "kind": "callback",
      "transport": "push",
      "wiring": "src/app/turn/push/push-stores.ts"
    },
    {
      "id": "push-requests",
      "from": "io/bridge/push",
      "to": "io/chat/push",
      "carries": "yui://push-reset → stopTurn and sendReset; yui://push-reconnect → reconnectNow",
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
      "carries": "sessions() → History tab; session diagnostics → Session section",
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
      "carries": "RemoteSurfaces: MessageSurfaceOp on yui://message-surface",
      "kind": "bridge",
      "transport": "shared",
      "wiring": "src/ui/surfaces/wire.ts"
    },
    {
      "id": "remote-surfaces",
      "from": "io/bridge/message",
      "to": "ui/surfaces",
      "carries": "MessageControlOp on yui://message-control: submit, stop, input-open, input-error-action, speech-action, dock, open-settings, ready",
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
      "id": "bubble-user",
      "from": "ui/message",
      "to": "user",
      "carries": "speech bubble text, the quoted user line, reasoning",
      "kind": "user",
      "transport": "shared"
    },
    {
      "id": "chips-user",
      "from": "ui/chips",
      "to": "user",
      "carries": "status pill, delegation chip",
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
            "mods-ingress"
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
          "label": "POST /agent-event, POST /signals",
          "edges": [
            "hooks-ingress",
            "signals-ingress"
          ],
          "to": "shell"
        },
        {
          "from": "shell",
          "label": "agent-inbox and signals-inbox events",
          "edges": [
            "ingress-inbox"
          ],
          "to": "tools"
        },
        {
          "from": "tools",
          "label": "agent and signal events",
          "edges": [
            "inbox-sources"
          ],
          "to": "sources"
        },
        {
          "from": "dispatcher",
          "label": "pacer gap and busy state hold inbox delivery",
          "edges": [
            "pacer-inbox"
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
        "id": "settings",
        "label": "settings",
        "role": "The quick-controls panel as a window, over its own store instances and mirrors of the pet window's push state and delegations."
      },
      {
        "id": "message",
        "label": "message",
        "role": "The speech bubble, text input, and plate popped out of the pet window, drawn from surface ops."
      },
      {
        "id": "devtools",
        "label": "devtools",
        "role": "Context inspector, advanced settings, and motion preview over reloaded stores."
      },
      {
        "id": "phone",
        "label": "phone",
        "role": "The Android window. It runs the same turn core on the push transport alone, with no avatar tools and no screen capture, and opens no bridge."
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
        "id": "mouth-preview",
        "from": "settings",
        "to": "pet",
        "carries": "yui://mouth-preview: number or null",
        "kind": "bridge"
      },
      {
        "id": "voice-set",
        "from": "settings",
        "to": "pet",
        "carries": "yui://voice-set: boolean",
        "kind": "bridge"
      },
      {
        "id": "voice-state",
        "from": "pet",
        "to": "settings",
        "carries": "yui://voice-state: {state}",
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
        "id": "push-state-settings",
        "from": "pet",
        "to": "settings",
        "carries": "yui://push-state, answered on yui://push-state-ask",
        "kind": "bridge"
      },
      {
        "id": "push-state-message",
        "from": "pet",
        "to": "message",
        "carries": "yui://push-state, answered on yui://push-state-ask",
        "kind": "bridge"
      },
      {
        "id": "push-reset",
        "from": "settings",
        "to": "pet",
        "carries": "yui://push-reset, yui://push-reconnect",
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
        "id": "delegations-message",
        "from": "pet",
        "to": "message",
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
        "id": "message-surface",
        "from": "pet",
        "to": "message",
        "carries": "yui://message-surface: MessageSurfaceOp",
        "kind": "bridge"
      },
      {
        "id": "message-control",
        "from": "message",
        "to": "pet",
        "carries": "yui://message-control: submit, stop, input-open, input-error-action, speech-action, dock, open-settings, ready",
        "kind": "bridge"
      }
    ]
  }
}
