globalThis.YUI_MAP =
{
  "title": "YUI client",
  "cover": [
    "src",
    "src-tauri/src"
  ],
  "layers": [
    {
      "id": "external",
      "label": "external"
    },
    {
      "id": "shell",
      "label": "src-tauri"
    },
    {
      "id": "contract",
      "label": "contract"
    },
    {
      "id": "base",
      "label": "tauri-env · logger"
    },
    {
      "id": "config",
      "label": "config"
    },
    {
      "id": "renderer",
      "label": "renderer"
    },
    {
      "id": "settings",
      "label": "settings"
    },
    {
      "id": "io",
      "label": "io"
    },
    {
      "id": "dispatcher",
      "label": "dispatcher"
    },
    {
      "id": "ambient",
      "label": "ambient"
    },
    {
      "id": "ui",
      "label": "ui"
    },
    {
      "id": "app",
      "label": "app"
    },
    {
      "id": "windows",
      "label": "windows"
    }
  ],
  "nodes": [
    {
      "id": "backend-request",
      "layer": "external",
      "label": "backend (request)",
      "external": true,
      "paths": [],
      "role": "The backend agent on a request transport: one HTTP streaming call per turn, Responses or Chat Completions."
    },
    {
      "id": "backend-push",
      "layer": "external",
      "label": "backend (push)",
      "external": true,
      "paths": [],
      "role": "The backend agent on the push transport: one WebSocket that carries turns in and replies out, and holds the conversation under a chat id."
    },
    {
      "id": "stt-service",
      "layer": "external",
      "label": "STT service",
      "external": true,
      "paths": [],
      "role": "The speech-to-text HTTP endpoint that turns a voice segment into text."
    },
    {
      "id": "tts-service",
      "layer": "external",
      "label": "TTS service",
      "external": true,
      "paths": [],
      "role": "The speech synthesis HTTP endpoint and its voices API."
    },
    {
      "id": "expression-broker",
      "layer": "external",
      "label": "Expression Broker",
      "external": true,
      "paths": [],
      "role": "The MCP server the client publishes its express vocabulary to."
    },
    {
      "id": "mods-avatar",
      "layer": "external",
      "label": "Mods/avatar",
      "external": true,
      "paths": [],
      "role": "The MCP server that reads body state and sends body commands over the loopback avatar endpoints."
    },
    {
      "id": "agent-hooks",
      "layer": "external",
      "label": "coding-agent hooks",
      "external": true,
      "paths": [],
      "role": "Lifecycle hooks of external coding agents that post done and needs-input events."
    },
    {
      "id": "signal-producers",
      "layer": "external",
      "label": "signal producers",
      "external": true,
      "paths": [],
      "role": "Outside producers that post signals for the character to speak about."
    },
    {
      "id": "shell/core",
      "layer": "shell",
      "label": "shell core",
      "paths": [
        "src-tauri/src/main.rs",
        "src-tauri/src/lib.rs",
        "src-tauri/src/plugins.rs",
        "src-tauri/src/setup.rs",
        "src-tauri/src/commands.rs"
      ],
      "role": "Builds the Tauri app: plugins, startup work, and the IPC command table."
    },
    {
      "id": "shell/os-event-watcher",
      "layer": "shell",
      "label": "os_event_watcher",
      "paths": [
        "src-tauri/src/os_event_watcher"
      ],
      "role": "Polls OS idle time and the frontmost window, lists windows, probes the drag release, and writes the witness log."
    },
    {
      "id": "shell/agent-ingress",
      "layer": "shell",
      "label": "agent_ingress",
      "paths": [
        "src-tauri/src/agent_ingress"
      ],
      "role": "Loopback HTTP listener for agent events, signals, and the avatar RPC round trip."
    },
    {
      "id": "shell/screenshot",
      "layer": "shell",
      "label": "screenshot",
      "paths": [
        "src-tauri/src/screenshot.rs"
      ],
      "role": "Enumerates screen sources and captures a display off the main thread."
    },
    {
      "id": "shell/window",
      "layer": "shell",
      "label": "window control",
      "paths": [
        "src-tauri/src/drag.rs",
        "src-tauri/src/window_frame.rs",
        "src-tauri/src/passthrough.rs"
      ],
      "role": "OS-native window drag, logical window frames, and the click-through toggle."
    },
    {
      "id": "shell/logs",
      "layer": "shell",
      "label": "logs",
      "paths": [
        "src-tauri/src/app_log.rs",
        "src-tauri/src/log_rotation.rs",
        "src-tauri/src/turn_log.rs"
      ],
      "role": "The app log sink with date rotation and the turn-record JSONL file."
    },
    {
      "id": "shell/tray",
      "layer": "shell",
      "label": "tray",
      "paths": [
        "src-tauri/src/tray.rs"
      ],
      "role": "System tray menu with its show, hide, settings, and quit actions."
    },
    {
      "id": "shell/imports",
      "layer": "shell",
      "label": "asset imports",
      "paths": [
        "src-tauri/src/import_fs.rs",
        "src-tauri/src/vrm_import.rs",
        "src-tauri/src/voice_import.rs",
        "src-tauri/src/stage_image.rs"
      ],
      "role": "Native copy of user-picked VRM, voice clip, and stage image files into app data."
    },
    {
      "id": "contract",
      "layer": "contract",
      "label": "contract",
      "paths": [
        "src/contract"
      ],
      "role": "TypeScript types of the wire schema between YUI and the backend."
    },
    {
      "id": "tauri-env",
      "layer": "base",
      "label": "tauri-env",
      "paths": [
        "src/tauri-env.ts"
      ],
      "role": "Detects whether the page runs inside the Tauri runtime."
    },
    {
      "id": "logger",
      "layer": "base",
      "label": "logger",
      "paths": [
        "src/logger.ts"
      ],
      "role": "Namespaced frontend logger with a runtime level."
    },
    {
      "id": "config",
      "layer": "config",
      "label": "config",
      "paths": [
        "src/config"
      ],
      "role": "Loads and validates configs/*.json, holds the reactive snapshot with hot reload, and names the secrets."
    },
    {
      "id": "renderer",
      "layer": "renderer",
      "label": "renderer core",
      "paths": [
        "src/renderer"
      ],
      "role": "The three.js scene and frame loop, VRM load and hot swap, and the routing of a control envelope into emotion and motion."
    },
    {
      "id": "renderer/camera",
      "layer": "renderer",
      "label": "camera",
      "paths": [
        "src/renderer/camera"
      ],
      "role": "Fit-to-bounds framing, zoom, orbit, and the travel view window."
    },
    {
      "id": "renderer/expression",
      "layer": "renderer",
      "label": "expression",
      "paths": [
        "src/renderer/expression"
      ],
      "role": "Emotion crossfade, amplitude lip sync, and cursor gaze on the face."
    },
    {
      "id": "renderer/motion",
      "layer": "renderer",
      "label": "motion",
      "paths": [
        "src/renderer/motion"
      ],
      "role": "Clip cache, motion scheduling and playback, holds, and root yaw."
    },
    {
      "id": "renderer/geometry",
      "layer": "renderer",
      "label": "geometry",
      "paths": [
        "src/renderer/geometry"
      ],
      "role": "Silhouette hit-testing, tap regions, and read-only screen probes of the model."
    },
    {
      "id": "renderer/props",
      "layer": "renderer",
      "label": "props",
      "paths": [
        "src/renderer/props"
      ],
      "role": "Furniture drawn in the character's scene."
    },
    {
      "id": "settings",
      "layer": "settings",
      "label": "settings",
      "paths": [
        "src/settings"
      ],
      "role": "Persisted user settings, one localStorage-backed store per setting."
    },
    {
      "id": "io/chat/stream",
      "layer": "io",
      "label": "chat stream",
      "paths": [
        "src/io/chat/stream"
      ],
      "role": "Request-transport streaming loops that turn a Responses or Chat Completions stream into chat stream events, with the client tool round trips."
    },
    {
      "id": "io/chat/push",
      "layer": "io",
      "label": "push socket",
      "paths": [
        "src/io/chat/push"
      ],
      "role": "The push transport's WebSocket, its frame shapes, and the queue that answers tool_call frames."
    },
    {
      "id": "io/chat/tools",
      "layer": "io",
      "label": "client tools",
      "paths": [
        "src/io/chat/tools"
      ],
      "role": "The tools the client declares to the backend and runs itself: generate_express, body_action, look."
    },
    {
      "id": "io/chat/vocabulary",
      "layer": "io",
      "label": "express vocabulary",
      "paths": [
        "src/io/chat/vocabulary"
      ],
      "role": "Derives the emotion, motion, and voice-tone ids the agent may cue with."
    },
    {
      "id": "io/chat/broker",
      "layer": "io",
      "label": "broker client",
      "paths": [
        "src/io/chat/broker"
      ],
      "role": "Write-only Expression Broker client and its URL override reconciler."
    },
    {
      "id": "io/chat/conversation",
      "layer": "io",
      "label": "conversation stores",
      "paths": [
        "src/io/chat/conversation"
      ],
      "role": "Transcript, context history, response-id session, and session diagnostics."
    },
    {
      "id": "io/chat/record",
      "layer": "io",
      "label": "turn record",
      "paths": [
        "src/io/chat/record"
      ],
      "role": "Appends one JSONL record per completed turn or skipped fire."
    },
    {
      "id": "io/chat/models",
      "layer": "io",
      "label": "model list",
      "paths": [
        "src/io/chat/models"
      ],
      "role": "Reads the model list of a chat endpoint."
    },
    {
      "id": "io/chat/secrets",
      "layer": "io",
      "label": "secret provider",
      "paths": [
        "src/io/chat/secret-provider.ts"
      ],
      "role": "Resolves each secret from its runtime store, then the build-time fallback."
    },
    {
      "id": "io/voice/stt",
      "layer": "io",
      "label": "voice input",
      "paths": [
        "src/io/voice"
      ],
      "role": "Microphone capture, VAD segmentation, and the STT upload of each segment."
    },
    {
      "id": "io/voice/tts",
      "layer": "io",
      "label": "speech output",
      "paths": [
        "src/io/voice/tts"
      ],
      "role": "Sentence segmentation, synthesis, in-order playback, and the glue to the mouth and the bubble."
    },
    {
      "id": "io/voice/filler",
      "layer": "io",
      "label": "filler",
      "paths": [
        "src/io/voice/filler"
      ],
      "role": "Filler phrases spoken while a turn is thinking, and the failure lines."
    },
    {
      "id": "io/voice/voices",
      "layer": "io",
      "label": "voices",
      "paths": [
        "src/io/voice/voices"
      ],
      "role": "The speaker catalogue: selection, the voices API per provider, and voice import."
    },
    {
      "id": "io/window/os-events",
      "layer": "io",
      "label": "os events",
      "paths": [
        "src/io/window"
      ],
      "role": "The os_event listen seam, the frontmost-window tracker, and the own-origin fetch rule."
    },
    {
      "id": "io/window/capture",
      "layer": "io",
      "label": "screen capture",
      "paths": [
        "src/io/window/capture"
      ],
      "role": "Screen enumeration and screenshot capture through the shell."
    },
    {
      "id": "io/window/geometry",
      "layer": "io",
      "label": "window geometry",
      "paths": [
        "src/io/window/geometry"
      ],
      "role": "Monitor and floor math, the travel and stationary frames, and keep-on-screen."
    },
    {
      "id": "io/window/openers",
      "layer": "io",
      "label": "window openers",
      "paths": [
        "src/io/window/openers"
      ],
      "role": "Opens and places the message, settings, and devtools windows."
    },
    {
      "id": "io/window/pet",
      "layer": "io",
      "label": "pet window",
      "paths": [
        "src/io/window/pet"
      ],
      "role": "The pet window's pointer gestures, click-through hit-test, gaze cursor, peek state, and summon hotkey."
    },
    {
      "id": "io/bridge/core",
      "layer": "io",
      "label": "bridge core",
      "paths": [
        "src/io/bridge/core"
      ],
      "role": "The cross-window bus transport and the owner and mirror pattern built on it."
    },
    {
      "id": "io/bridge/settings",
      "layer": "io",
      "label": "settings bridge",
      "paths": [
        "src/io/bridge/settings-bridge.ts"
      ],
      "role": "Typed cross-window settings bus."
    },
    {
      "id": "io/bridge/message",
      "layer": "io",
      "label": "message bridge",
      "paths": [
        "src/io/bridge/message"
      ],
      "role": "The bus between the pet window and the message window, and the message window's surfaces as a remote half."
    },
    {
      "id": "io/bridge/delegations",
      "layer": "io",
      "label": "delegations",
      "paths": [
        "src/io/bridge/delegations"
      ],
      "role": "The backend's background-work list: live store, persisted history, and its mirror."
    },
    {
      "id": "io/bridge/reasoning",
      "layer": "io",
      "label": "reasoning",
      "paths": [
        "src/io/bridge/reasoning"
      ],
      "role": "The backend's reasoning text as the current turn writes it, and its mirror."
    },
    {
      "id": "io/bridge/push",
      "layer": "io",
      "label": "push state bridge",
      "paths": [
        "src/io/bridge/push"
      ],
      "role": "Push socket state published to the windows that do not own the socket."
    },
    {
      "id": "io/bridge/inbox",
      "layer": "io",
      "label": "inbox",
      "paths": [
        "src/io/bridge/inbox"
      ],
      "role": "Subscriptions to the shell's agent, signals, and avatar RPC channels, and the avatar executor that answers body commands."
    },
    {
      "id": "io/assets",
      "layer": "io",
      "label": "assets",
      "paths": [
        "src/io/assets"
      ],
      "role": "VRM selection and import, and the phone stage background."
    },
    {
      "id": "io/guide",
      "layer": "io",
      "label": "guide docs",
      "paths": [
        "src/io/guide"
      ],
      "role": "The bundled guide docs handed to the backend on an Ask press."
    },
    {
      "id": "io/image",
      "layer": "io",
      "label": "image encode",
      "paths": [
        "src/io/image"
      ],
      "role": "JPEG encoding of images sent to the backend."
    },
    {
      "id": "io/lifecycle",
      "layer": "io",
      "label": "page lifecycle",
      "paths": [
        "src/io/lifecycle"
      ],
      "role": "The Android back-button claim and page visibility."
    },
    {
      "id": "io/stage",
      "layer": "io",
      "label": "stage pointer",
      "paths": [
        "src/io/stage"
      ],
      "role": "Press travel and the touch gesture recognizer every stage surface shares."
    },
    {
      "id": "dispatcher",
      "layer": "dispatcher",
      "label": "dispatcher",
      "paths": [
        "src/dispatcher"
      ],
      "role": "The router: pumps the bus, classifies each envelope, and runs one backend call at a time."
    },
    {
      "id": "dispatcher/core",
      "layer": "dispatcher",
      "label": "bus and gates",
      "paths": [
        "src/dispatcher/core"
      ],
      "role": "The event bus, tier classification, guardrails, and the proactive pacer."
    },
    {
      "id": "dispatcher/tier1",
      "layer": "dispatcher",
      "label": "tier 1",
      "paths": [
        "src/dispatcher/tier1"
      ],
      "role": "Local reactions that need no backend: directives, the posture ledger, and pin targets."
    },
    {
      "id": "dispatcher/turn",
      "layer": "dispatcher",
      "label": "turn",
      "paths": [
        "src/dispatcher/turn"
      ],
      "role": "The turn ledger, the TurnOutput and TurnFeed ports, push-turn ids, and the player of push reply frames."
    },
    {
      "id": "dispatcher/backend",
      "layer": "dispatcher",
      "label": "backend call",
      "paths": [
        "src/dispatcher/backend"
      ],
      "role": "Builds the client context, sends a tier-2 event on the selected transport, settles the reply, and records the turn."
    },
    {
      "id": "dispatcher/sources/user-input",
      "layer": "dispatcher",
      "label": "user input source",
      "paths": [
        "src/dispatcher/sources"
      ],
      "role": "Turns typed text and STT results into bus envelopes."
    },
    {
      "id": "dispatcher/sources/idle-tick",
      "layer": "dispatcher",
      "label": "idle-tick sources",
      "paths": [
        "src/dispatcher/sources/idle-tick"
      ],
      "role": "Proactive, schedule, milestone, and screen firing sources driven by the OS idle tick."
    },
    {
      "id": "dispatcher/sources/inbox",
      "layer": "dispatcher",
      "label": "inbox sources",
      "paths": [
        "src/dispatcher/sources/inbox"
      ],
      "role": "Agent-lifecycle and signals firing sources with presence-gated buffering."
    },
    {
      "id": "dispatcher/sources/gesture",
      "layer": "dispatcher",
      "label": "gesture sources",
      "paths": [
        "src/dispatcher/sources/gesture"
      ],
      "role": "Tap, drag-hold, and window-drop firing sources, with the perch watch and placement."
    },
    {
      "id": "dispatcher/sources/wake",
      "layer": "dispatcher",
      "label": "wake source",
      "paths": [
        "src/dispatcher/sources/wake"
      ],
      "role": "Fires the wake candidate as she gets out of bed."
    },
    {
      "id": "ambient/liveliness",
      "layer": "ambient",
      "label": "liveliness",
      "paths": [
        "src/ambient/liveliness"
      ],
      "role": "Blink, idle sway, breath, and look-around, independent of the backend."
    },
    {
      "id": "ambient/locomotion",
      "layer": "ambient",
      "label": "locomotion",
      "paths": [
        "src/ambient/locomotion"
      ],
      "role": "Movement loops over the real window: stroll, perch, climb, jump, fall, and sit transitions."
    },
    {
      "id": "ambient/bed-scene",
      "layer": "ambient",
      "label": "bed scene",
      "paths": [
        "src/ambient/bed-scene"
      ],
      "role": "Asleep on a bed at launch or on command, the wake, and the exit."
    },
    {
      "id": "ui/surfaces",
      "layer": "ui",
      "label": "surfaces",
      "paths": [
        "src/ui/surfaces"
      ],
      "role": "The speech bubble and text input as one system, and the router between the pet window and the message window."
    },
    {
      "id": "ui/input",
      "layer": "ui",
      "label": "text input",
      "paths": [
        "src/ui/input"
      ],
      "role": "The composer: submit, stop, mic button, and image attachments."
    },
    {
      "id": "ui/message",
      "layer": "ui",
      "label": "bubble and plate",
      "paths": [
        "src/ui/message"
      ],
      "role": "The speech bubble, the quoted user line, the reasoning disclosure, and the message-window plate."
    },
    {
      "id": "ui/chips",
      "layer": "ui",
      "label": "chips",
      "paths": [
        "src/ui/chips"
      ],
      "role": "The status pill, the delegation chip, and the voice-input status model."
    },
    {
      "id": "ui/notices",
      "layer": "ui",
      "label": "notices",
      "paths": [
        "src/ui/notices"
      ],
      "role": "One-off and error notices."
    },
    {
      "id": "ui/quick-controls",
      "layer": "ui",
      "label": "quick controls",
      "paths": [
        "src/ui/quick-controls"
      ],
      "role": "The settings panel, shown as a popover in the pet window and as the whole settings window."
    },
    {
      "id": "ui/phone",
      "layer": "ui",
      "label": "phone ui",
      "paths": [
        "src/ui/phone"
      ],
      "role": "Phone-window layout, settings sheet, and stage backdrop."
    },
    {
      "id": "ui/devtools",
      "layer": "ui",
      "label": "devtools ui",
      "paths": [
        "src/ui/devtools"
      ],
      "role": "Developer Tools views: context inspector, advanced settings, motion preview."
    },
    {
      "id": "ui/i18n",
      "layer": "ui",
      "label": "i18n",
      "paths": [
        "src/ui/i18n.ts",
        "src/ui/i18n"
      ],
      "role": "The persisted locale and its string catalogs."
    },
    {
      "id": "app/bootstrap",
      "layer": "app",
      "label": "pet bootstrap",
      "paths": [
        "src/app"
      ],
      "role": "The pet window's config-derived composition root and the shared teardown bag."
    },
    {
      "id": "app/turn",
      "layer": "app",
      "label": "turn wiring",
      "paths": [
        "src/app/turn"
      ],
      "role": "Connects voice, dispatcher, sources, vocabulary, broker, and the push transport into the chat turn."
    },
    {
      "id": "app/stage",
      "layer": "app",
      "label": "stage wiring",
      "paths": [
        "src/app/stage"
      ],
      "role": "Binds the renderer, gestures, locomotion, the bed scene, and the window sources to the pet stage."
    },
    {
      "id": "app/cross-window",
      "layer": "app",
      "label": "cross-window wiring",
      "paths": [
        "src/app/cross-window"
      ],
      "role": "Per-window settings sync over the bridge and storage events."
    },
    {
      "id": "app/settings",
      "layer": "app",
      "label": "settings wiring",
      "paths": [
        "src/app/settings"
      ],
      "role": "Store bags, the config store with its live merges and reload, and avatar selection."
    },
    {
      "id": "app/controls",
      "layer": "app",
      "label": "controls wiring",
      "paths": [
        "src/app/controls"
      ],
      "role": "The pet window's quick-controls panel, context menu, and guide requests."
    },
    {
      "id": "app/message",
      "layer": "app",
      "label": "message-window wiring",
      "paths": [
        "src/app/message"
      ],
      "role": "Draws surface ops from the pet window and binds the message window's drag, focus, and resize."
    },
    {
      "id": "app/settings-window",
      "layer": "app",
      "label": "settings-window wiring",
      "paths": [
        "src/app/settings-window"
      ],
      "role": "Composes the settings window and mirrors the voice toggle."
    },
    {
      "id": "app/phone",
      "layer": "app",
      "label": "phone wiring",
      "paths": [
        "src/app/phone"
      ],
      "role": "The phone window's turn core, settings view, stage, top row, and voice controller."
    },
    {
      "id": "app/voice",
      "layer": "app",
      "label": "voice fix",
      "paths": [
        "src/app/voice"
      ],
      "role": "The desktop pill's setup-needed tap."
    },
    {
      "id": "app/dev",
      "layer": "app",
      "label": "dev globals",
      "paths": [
        "src/app/dev"
      ],
      "role": "DEV-only console handles."
    },
    {
      "id": "windows",
      "layer": "windows",
      "label": "window entries",
      "paths": [
        "src/windows"
      ],
      "role": "One entry file per window, loaded by the matching HTML file."
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
      "carries": "tool_status, reasoning → TurnFeed.toolStatus, reasoning",
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
      "carries": "showTool, finishTool, hideTool → status pill",
      "kind": "callback",
      "transport": "shared",
      "wiring": "src/windows/main.ts"
    },
    {
      "id": "feed-surfaces",
      "from": "dispatcher/turn",
      "to": "ui/surfaces",
      "carries": "TurnFeed.onToolStatus → showTool, finishTool, hideTool",
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
      "carries": "hello.tools: the avatar tools",
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
      "carries": "runClientCall → executeClientTool(tool, args) → ClientToolResult",
      "kind": "call",
      "transport": "request"
    },
    {
      "id": "push-tools",
      "from": "io/chat/push",
      "to": "io/chat/tools",
      "carries": "tool_call frame → executeClientTool → tool_result frame",
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
      "id": "capture-shell",
      "from": "io/window/capture",
      "to": "shell/screenshot",
      "carries": "list_screen_sources, capture_screen, capture_screen_at",
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
      "carries": "os_event {os_idle_tick: os_idle_ms, frontmost_app, frontmost_title} every 5 s",
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
      "from": "io/window/geometry",
      "to": "shell/window",
      "carries": "set_frame_logical {x, y, width, height}",
      "kind": "tauri-command",
      "transport": "shared"
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
      "wiring": "src/app/stage/wire-locomotion.ts"
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
      "transport": "shared",
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
      "carries": "MessageControlOp on yui://message-control: submit, stop, dock, open-settings, ready",
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
    }
  ],
  "flows": [
    {
      "id": "turn",
      "title": "A user turn",
      "steps": [
        {
          "edges": [
            "input-submit",
            "surfaces-submit"
          ],
          "text": "The composer submits text and images to the user input source."
        },
        {
          "edges": [
            "stt-http",
            "stt-submit"
          ],
          "text": "A voice segment goes to the STT service and its transcript enters the same source."
        },
        {
          "edges": [
            "user-input-bus"
          ],
          "text": "The source pushes a user envelope onto the event bus."
        },
        {
          "edges": [
            "bus-dispatcher",
            "user-supersede"
          ],
          "text": "The pump pops it. A user turn aborts the call in flight and drops pending ones, and the envelope classifies as tier 2."
        },
        {
          "edges": [
            "dispatcher-ledger",
            "ledger-quote",
            "dispatcher-busy"
          ],
          "text": "The dispatcher opens the turn in the ledger, the bubble quotes the user, and the send button becomes stop."
        },
        {
          "edges": [
            "dispatcher-backend",
            "backend-output",
            "output-filler"
          ],
          "text": "The backend caller interrupts the previous speech and starts thinking, which starts the filler loop."
        },
        {
          "edges": [
            "context-posture",
            "context-frontmost",
            "context-screenshot",
            "context-settings",
            "context-endpoints"
          ],
          "text": "The caller builds the client context from posture, the frontmost app, a screenshot, settings, and the previous turn."
        },
        {
          "edges": [
            "vocabulary-tools",
            "tools-backend",
            "conversation-backend",
            "backend-stream",
            "stream-http"
          ],
          "text": "The caller adds the tool schemas and the conversation state and streams the request over HTTP.",
          "transport": "request"
        },
        {
          "edges": [
            "stream-events",
            "backend-feed",
            "feed-surfaces",
            "feed-tool",
            "feed-reasoning"
          ],
          "text": "Stream events come back: speech deltas and cues go to TurnOutput, tool status and reasoning to TurnFeed.",
          "transport": "request"
        },
        {
          "edges": [
            "backend-push-send",
            "backend-push-wait",
            "push-ws"
          ],
          "text": "The caller sends one turn frame on the push socket and waits for its turn_end.",
          "transport": "push"
        },
        {
          "edges": [
            "push-ws-in",
            "push-render",
            "push-feed",
            "render-output",
            "feed-surfaces",
            "feed-tool",
            "feed-reasoning"
          ],
          "text": "Reply frames arrive on the socket: speech and render frames play through render-turn into TurnOutput, tool_status and reasoning go to TurnFeed.",
          "transport": "push"
        },
        {
          "edges": [
            "output-speech",
            "tts-http"
          ],
          "text": "Speech playback segments the text into sentences and synthesizes each one."
        },
        {
          "edges": [
            "speech-bubble",
            "surfaces-bubble",
            "speech-renderer",
            "renderer-expression",
            "renderer-motion"
          ],
          "text": "Each sentence writes the bubble, applies its cue to the renderer, and drives the mouth by amplitude."
        },
        {
          "edges": [
            "settle-renderer"
          ],
          "text": "When no cue was streamed with speech, the settled envelope is applied to the renderer directly.",
          "transport": "request"
        },
        {
          "edges": [
            "backend-record",
            "backend-turn-record",
            "record-shell"
          ],
          "text": "The caller records the turn into the transcript, the context history, and the turn-record log."
        },
        {
          "edges": [
            "render-conversation",
            "render-record",
            "push-usage"
          ],
          "text": "The rendered reply is recorded as the assistant entry, and turn_end carries the usage.",
          "transport": "push"
        },
        {
          "edges": [
            "speech-ledger",
            "speech-previous"
          ],
          "text": "Playback end clears audio owed in the ledger and stores how the utterance ended for the next turn's previous: line."
        },
        {
          "edges": [
            "previous-playback",
            "push-ws"
          ],
          "text": "A turn that failed before its utterance started is reported on a playback frame.",
          "transport": "push"
        }
      ]
    },
    {
      "id": "backend-turn",
      "title": "A backend-started turn",
      "steps": [
        {
          "edges": [
            "push-ws-in"
          ],
          "text": "A speech or render frame arrives with a turn id the client never opened.",
          "transport": "push"
        },
        {
          "edges": [
            "push-render"
          ],
          "text": "render-turn takes it under the backend event name. The bus, the gates, the ledger, and the context builder take no part.",
          "transport": "push"
        },
        {
          "edges": [
            "render-output",
            "output-speech",
            "tts-http"
          ],
          "text": "It plays through TurnOutput behind any speech already queued.",
          "transport": "push"
        },
        {
          "edges": [
            "speech-bubble",
            "speech-renderer"
          ],
          "text": "Speech playback writes the bubble and drives the renderer as for any turn.",
          "transport": "push"
        },
        {
          "edges": [
            "render-conversation",
            "render-record"
          ],
          "text": "The reply is recorded as an assistant transcript entry and a render record.",
          "transport": "push"
        }
      ]
    },
    {
      "id": "tool-call",
      "title": "A tool call and an avatar command",
      "steps": [
        {
          "edges": [
            "vocabulary-derive",
            "vocabulary-settings"
          ],
          "text": "The express vocabulary is derived from the config and the express-motion selection."
        },
        {
          "edges": [
            "vocabulary-tools",
            "tools-backend"
          ],
          "text": "On a request transport the tool schemas are rebuilt from the vocabulary for each turn.",
          "transport": "request"
        },
        {
          "edges": [
            "vocabulary-push",
            "tools-push",
            "push-ws"
          ],
          "text": "On push the vocabulary and the avatar tools travel in hello, and expression arrives as cues on reply segments.",
          "transport": "push"
        },
        {
          "edges": [
            "stream-events",
            "stream-tools"
          ],
          "text": "A function call in the stream runs the client tool and its result goes back within the same request loop.",
          "transport": "request"
        },
        {
          "edges": [
            "push-ws-in",
            "push-tools",
            "push-image",
            "push-ws"
          ],
          "text": "A tool_call frame is queued, run, and answered with a tool_result frame fitted to the turn size.",
          "transport": "push"
        },
        {
          "edges": [
            "tools-executor"
          ],
          "text": "body_action and look reach the avatar executor."
        },
        {
          "edges": [
            "tools-capture",
            "capture-shell"
          ],
          "text": "look at screen captures the display under a point through the shell."
        },
        {
          "edges": [
            "mods-ingress",
            "ingress-inbox",
            "inbox-rpc-response"
          ],
          "text": "The same executor answers the loopback avatar endpoints: the shell emits avatar-rpc and waits for avatar_rpc_response."
        },
        {
          "edges": [
            "executor-locomotion",
            "executor-perch",
            "executor-bed",
            "executor-posture"
          ],
          "text": "A command cancels the ambient movers, then places her on a window, moves the window, or uses the bed."
        },
        {
          "edges": [
            "gesture-bus",
            "dispatcher-tier1",
            "tier1-renderer",
            "tier1-peek"
          ],
          "text": "Placement pushes the sit or peek drop envelope without its gesture cue, and tier 1 renders the posture."
        }
      ]
    },
    {
      "id": "stop",
      "title": "Stop",
      "steps": [
        {
          "edges": [
            "input-submit",
            "stop-dispatcher"
          ],
          "text": "The stop button cancels the call in flight and drops pending ones."
        },
        {
          "edges": [
            "stop-push-turns"
          ],
          "text": "Open push turn ids move to stopped, so their later frames drop."
        },
        {
          "edges": [
            "stop-speech"
          ],
          "text": "Speech playback is interrupted and the cut utterance is stored for the next turn."
        },
        {
          "edges": [
            "stop-push",
            "push-ws"
          ],
          "text": "The cut turn ids go to the backend on a stop frame.",
          "transport": "push"
        },
        {
          "edges": [
            "user-supersede"
          ],
          "text": "A new user turn reaches the same end through the dispatcher: it aborts the call in flight before its own call starts."
        },
        {
          "edges": [
            "barge-in-speech",
            "barge-in-push"
          ],
          "text": "Speech into the microphone while she is speaking interrupts playback and cuts push turns."
        }
      ]
    },
    {
      "id": "firing",
      "title": "Firing and classification of a speech candidate",
      "steps": [
        {
          "edges": [
            "os-event",
            "os-idle-tick",
            "os-presence"
          ],
          "text": "The shell emits an idle and frontmost sample every 5 s, and the idle-tick and inbox sources read it."
        },
        {
          "edges": [
            "settings-idle-tick",
            "idle-tick-bus"
          ],
          "text": "Proactive, schedule, milestone, and screen sources fire from that sample and their settings."
        },
        {
          "edges": [
            "hooks-ingress",
            "signals-ingress",
            "ingress-inbox",
            "inbox-sources",
            "settings-inbox"
          ],
          "text": "Agent events and signals arrive on the loopback listener and reach the inbox sources."
        },
        {
          "edges": [
            "pacer-inbox",
            "inbox-bus",
            "signals-drain",
            "signals-drain-wake"
          ],
          "text": "Inbox sources deliver while she is present and the pipeline is free, and buffered signals ride the milestone and wake envelopes."
        },
        {
          "edges": [
            "pet-gestures",
            "tap-renderer",
            "gesture-bus",
            "pet-drag-bus"
          ],
          "text": "Taps, pats, drags, and window drops become envelopes from the gesture sources."
        },
        {
          "edges": [
            "locomotion-bus",
            "bed-bus",
            "bed-wake",
            "wake-bus"
          ],
          "text": "Ambient movement and the bed scene push their own events, and waking fires the wake candidate."
        },
        {
          "edges": [
            "bus-dispatcher"
          ],
          "text": "The dispatcher classifies each envelope. Tier 2 passes the pacer gap for paced sources and the guardrails."
        },
        {
          "edges": [
            "dispatcher-tier1",
            "tier1-renderer",
            "tier1-peek"
          ],
          "text": "Tier 1 renders locally: a directive to the renderer, the posture ledger, and the peek state."
        },
        {
          "edges": [
            "dispatcher-backend"
          ],
          "text": "Tier 2 becomes a backend call, where the backend judges whether and what to speak."
        },
        {
          "edges": [
            "screen-skip-record",
            "record-shell"
          ],
          "text": "A screen fire the pacer held is written as a skip record."
        }
      ]
    },
    {
      "id": "settings",
      "title": "Settings propagation",
      "steps": [
        {
          "edges": [
            "controls-settings"
          ],
          "text": "A control commits to its store, which saves to localStorage."
        },
        {
          "edges": [
            "settings-broadcast"
          ],
          "text": "The store notifies and, after 200 ms, the window emits the settings-changed signal."
        },
        {
          "edges": [
            "settings-reload"
          ],
          "text": "Each other window reloads its own store instances from localStorage."
        },
        {
          "edges": [
            "settings-push",
            "settings-guardrails",
            "settings-pacer",
            "settings-camera",
            "settings-idle-motion",
            "vocabulary-settings"
          ],
          "text": "Subscribed consumers apply the change at once: push socket, guardrails and pacer, camera, idle motions, vocabulary."
        },
        {
          "edges": [
            "context-settings",
            "context-endpoints",
            "settings-speech",
            "settings-stt",
            "settings-idle-tick",
            "settings-inbox"
          ],
          "text": "Read-at-use consumers see it on their next turn, utterance, segment, or tick."
        },
        {
          "edges": [
            "ingress-start"
          ],
          "text": "The agent ingress port and switch are read once at boot."
        },
        {
          "edges": [
            "config-renderer",
            "config-guardrails",
            "vocabulary-derive"
          ],
          "text": "A config file edit reaches the renderer, guardrails, and vocabulary through hot reload, which polls in dev builds."
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
        "carries": "yui://message-control: submit, stop, input-open, dock, open-settings, ready",
        "kind": "bridge"
      }
    ]
  }
}
