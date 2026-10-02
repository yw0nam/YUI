# Features

Everything YUI does today, grouped by area. The README shows the three headline features in motion.

## Character

| Feature | What it does |
| --- | --- |
| Models | VRM 1.0 and 0.x loading with hot-swap, the bundled Sendagaya Shino as the default, and import, rename, and delete for your own `.vrm` files |
| Emotions and motions | 10 emotions and 25 motions, 9 of them agent-selectable, with a per-emotion fallback chain ending at `neutral` ([motion catalog](../reference/motions.md)) |
| Cursor gaze | Head and eyes that follow the OS cursor anywhere on screen, with an on/off switch |
| Lipsync | Mouth movement from speech amplitude, with a gain slider |
| Idle liveliness | Blink, sway, breathing, and look-around on the client, reduced to blinking under `prefers-reduced-motion` |
| Camera | Auto-framing, wheel zoom, Shift+drag orbit, and a reset to the front view |

## Desktop pet

| Feature | What it does |
| --- | --- |
| Overlay | Transparent, frameless, always-on-top window with click-through on empty pixels |
| Drag and resize | OS-native drag across monitors, and Ctrl+wheel resize anchored at the feet |
| Perch and peek | A seat on a window's top edge or a spot behind its side edge after a drop there, released when the window moves, closes, or covers her |
| Locomotion | Floor walks, strolls and jumps across window tops, and falls with a landing; climbing up window sides and onto the monitor above, labelled in development; switches for climbing and falling in the General tab |
| Touch | Reactions to taps on the head, chest, and hips and a press-and-hold head pat, with one touch cue a minute to the agent (`configs/avatar.json`) |
| Summon and tray | Global `CmdOrCtrl+Shift+Y` shortcut that brings her forward and focuses the text input (`configs/hotkeys.json`), and a tray menu with show/hide, Settings, and Quit |

## Conversation and voice

| Feature | What it does |
| --- | --- |
| Speech bubble | Streaming markdown with links in the default browser; in the message window the backend's reasoning folds open at its top; the running tool shows in the status pill above the character |
| Text input | Text box with up to 6 image attachments by paste, drag-and-drop, or file picker |
| Voice input | Silero VAD speech detection, transcription on any OpenAI-compatible STT endpoint, and barge-in over her speech |
| Voice output | Sentence-by-sentence TTS on Irodori, OpenAI, or Fish Audio with the `emotion_text` voice tag ([vocabulary](../reference/tts-emotion/)). Irodori lists the TTS server's voices and imports your own reference clip; OpenAI lists its built-in voices; Fish lists your voice models, imports a clip as a new model, and accepts any library voice id |
| Waiting filler | Thinking motion and short localized lines while a reply is pending, including tool-specific lines, and a spoken line when a turn times out or the backend can't be reached. Defaults come from `configs/filler.json`; every list is editable per language under Settings → **Talk** → **Thinking interjections** (**More phrases** for the long-wait, timeout, connection-lost, and tool lines) |
| History and message window | History tab stored on the device, and an optional separate message window |

## Backend

| Feature | What it does |
| --- | --- |
| Chat protocols | `chat_completions`, `responses`, and `push`, selected by `chat_api` in `configs/endpoints.json` ([push transport](../reference/push-transport.md)) |
| Expression cues | `generate_express` cues for emotion, motion, voice tag, and caption; the renderable vocabulary travels in the tool schema on Chat Completions, in the `hello` and `vocabulary` frames on push, and to the Expression Broker (MCP) when `broker_base_url` is set ([cue contract](../reference/client-context.md)) |
| Provider presets | OpenAI, Ollama, LM Studio, Groq, and Hermes Agent presets, plus a custom endpoint |
| Per-turn context | `client_context` text with local time, frontmost app and window title, an optional screenshot, body posture, and the outcome of the previous turn ([format](../reference/client-context.md)) |
| Silence | An empty reply or a bare `[SILENT]` token as a silent turn |
| Delegated tasks | Chip for work the agent runs in the background, with persisted history (push transport) |

## Proactive and context

| Feature | What it does |
| --- | --- |
| Greetings and check-ins | Scheduled greetings (09:00, 12:00, 18:00, 23:00 by default) and idle check-ins after 5, 10, and 30 quiet minutes, all editable in the Proactive tab |
| Screen watch | Cues on a switch to another app after 10 minutes in the previous one, and on every 45 minutes in one app, off by default (`configs/screen.json`) |
| First activity of the day | Cue on the first activity of each local day |
| Guardrails | Per-source debounce, hourly caps of 24 cues and 40 self-started turns (`configs/guardrails.json`), and a 10-minute default quiet gap after each turn |
| Loopback ingress | Local listener on port 8770 for coding-agent hooks, `/signals`, and the `avatar` Mod, active while the Agent notifications switch in the Proactive tab is on (off by default, applied at next launch) |
| Coding-agent hooks | `POST /agent-event` for finished tasks and input requests from coding agents ([hooks guide](https://github.com/yw0nam/YUI/blob/main/docs/agent-guide/agent-completion-hooks.md)) |
| Signals ingress | `POST /signals` for batches of external signals ([envelope](../reference/signals-ingress.md)) |
| Daily briefing | Skill for a backend agent that runs scheduled producers on its own machine and speaks their dated briefings on the first activity of the day or on request, with the Scheduled greeting switch on ([skill](https://github.com/yw0nam/YUI/blob/main/integrations/skills/yui-daily-briefing/SKILL.md)) |
| Witness log | Local JSONL of app switches and idle periods, kept for 14 days ([format](../reference/witness-log.md)) |
| Workflows | Saved endpoints fired from a button in the Proactive tab |

## Extensibility

| Feature | What it does |
| --- | --- |
| Mods | Standalone MCP servers `router`, `desktop-control`, `shell-sandbox`, and `avatar`; the `avatar` Mod seats her on a window, makes her peek, or moves her to a screen spot through the loopback ingress ([Mods](https://github.com/yw0nam/YUI/blob/main/Mods/README.md), [tool reference](../reference/mods.md)) |
| Integrations | Backend-agent adapters and backend-agnostic skills under [`integrations/`](https://github.com/yw0nam/YUI/tree/main/integrations), for example the Hermes Agent plugins |

## Platform

| Feature | What it does |
| --- | --- |
| Languages | English, Japanese, and Korean UI, with the OS language as the first-run default |
| Configuration | Runtime settings in `configs/`, validated at load, with hot-reload in development |
| Logs | One log file per day shared by frontend and Rust lines ([location](https://github.com/yw0nam/YUI/blob/main/docs/agent-guide/build-run.md#logs), [convention](../reference/logging.md)) |
| Platforms | macOS on Apple Silicon (official) and experimental Windows x64 builds; Intel Mac and Linux are not officially supported |

