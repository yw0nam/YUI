# Features

Everything YUI does today, grouped by area. [What she can do](capabilities.md) covers the same in prose.

## Character

| Feature | What it does |
| --- | --- |
| Models | VRM 1.0 and 0.x, hot-swap, the bundled Shino, imports you rename or delete |
| Emotions and motions | 10 emotions, 27 motions, 8 the backend can pick, falling back to neutral ([catalog](motions.md)) |
| Cursor gaze | Head and eyes follow the cursor on screen |
| Lipsync | Mouth movement with speech amplitude, with a gain slider |
| Idle liveliness | Blink, sway, breathing, and look-around, quieter under reduced motion |
| Camera | Auto-framing, wheel zoom, Shift+drag orbit, front-view reset |
| Relations | Her feelings toward you and the others, by hand or backend |
| Bed scene | Starts asleep in bed, and the backend lays her down |

## Desktop pet

| Feature | What it does |
| --- | --- |
| Overlay | Transparent, frameless, on top, click-through on empty pixels |
| Drag and resize | Native drag across monitors, Ctrl+wheel resize at her feet |
| Perch and peek | Sits on a window's top edge, or peeks from behind it, until it moves or closes |
| Locomotion | Walks, window-top jumps, falls with a landing, climbing in development |
| Touch | Taps on head, chest, and hips, a head pat, one cue a minute |
| Summon and tray | Global summon shortcut, and a tray menu with Settings and Quit |

## Conversation and voice

| Feature | What it does |
| --- | --- |
| Speech bubble | Streaming markdown, 40 ms per character, with **Backlog** |
| Text input | Up to 6 image attachments by paste, drag, or picker |
| Voice input | Voice detection, any OpenAI-compatible STT endpoint, barge-in |
| Voice output | Sentence-by-sentence TTS on Irodori, OpenAI, or Fish Audio ([vocabulary](tts-emotion/)) |
| Reading dictionary | `word=reading` pairs that change the voice, never the bubble |
| Waiting filler | A thinking motion and short lines while a reply is pending, editable per language |
| History and message window | History on the device with every Signal, and an optional message window |
| Unified chat window | One window for every open character, with a cast row |

## Backend

| Feature | What it does |
| --- | --- |
| Chat protocols | Chat Completions, Responses, or Push, on Connection ([push transport](../reference/push-transport.md)) |
| Expression cues | `generate_express` for emotion, motion, voice tag, caption ([contract](../reference/client-context.md)) |
| Browser tool | Web pages in ego lite, in a task space per character, from the official `browser` plugin |
| Provider presets | OpenAI, Ollama, LM Studio, Groq, Hermes Agent, and a custom endpoint |
| Per-turn context | Time, frontmost app, a screenshot, posture, last outcome ([format](../reference/client-context.md)) |
| Silence | An empty reply or a bare `[SILENT]` token as a silent turn |
| Delegated tasks | On push, a chip for background work, with saved history |

## Proactive and context

| Feature | What it does |
| --- | --- |
| Greetings and check-ins | Greetings at 09:00, 12:00, 18:00, 23:00, and check-ins after 5, 10, 30 quiet minutes |
| Screen watch | App switches after 10 minutes, every 45 minutes in one app, off by default |
| First activity of the day | A cue on your first activity of the day |
| Guardrails | Per-source debounce, hourly caps, a 2-turn chain cap, a 10-minute quiet gap |
| Loopback ingress | Local listener for hooks, signals, and avatar RPC, off by default |
| Signals ingress | `POST /signals` for batches of external signals ([envelope](../reference/signals-ingress.md)) |
| Daily briefing | Speaks dated briefings on first activity or on request, with Scheduled greeting on ([skill](https://github.com/yw0nam/YUI/blob/main/integrations/skills/yui-daily-briefing/SKILL.md)) |
| Witness log | App switches and idle periods, kept 14 days ([format](../reference/witness-log.md)) |
| Workflows | Saved endpoints fired from a button on Proactive; the first run is a connection test |

## Extensibility

| Feature | What it does |
| --- | --- |
| Plugins | MCP servers and skills under `plugins/`, attached through the backend agent's MCP configuration, such as the [Factorio bridge](https://github.com/yw0nam/YUI/blob/main/plugins/factorio/README.md) |
| Plugins page | Installs catalog plugins such as `browser` and runs their servers with consent ([Plugins](plugins.md)) |
| Integrations | Wiring for one backend agent and backend-agnostic skills under `integrations/`, such as Hermes |

## Platform

| Feature | What it does |
| --- | --- |
| Languages | English, Japanese, and Korean UI, the OS language first |
| Appearance | Dawn and Hearth themes, following the OS by default |
| Configuration | Settings validated at load, with hot-reload in development |
| Logs | One file per day, frontend and Rust lines together ([convention](../reference/logging.md)) |
| Platforms | macOS Apple Silicon and Windows x64; Intel Mac and Linux are not officially supported |

For each release, see [What's new](whats-new.md).
