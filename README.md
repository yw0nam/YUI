<div align="center">

# YUI

**Make your own waifu live on your desktop.**

*Not a chatbot in a tab. A character who is actually there — standing on your window, watching the cursor, talking when she has something to say.*

![CI](https://github.com/yw0nam/YUI/actions/workflows/ci.yml/badge.svg)
![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![three.js](https://img.shields.io/badge/three.js-000000?logo=three.js&logoColor=white)

<a href="https://youtu.be/dIOQdoAp0GE"><img src="docs/public/yui-hero.gif" alt="YUI — a VRM character standing over a browser window as a transparent, always-on-top overlay: her head and eyes follow the mouse cursor, then she answers a typed question about what is on screen in a speech bubble" width="820">

</a>

[▶ Watch the full demo](https://youtu.be/dIOQdoAp0GE)

</div>

## Why this exists

The name is not an accident. YUI is named after
[Yui from *Sword Art Online*](https://swordartonline.fandom.com/wiki/Yui) — an
AI who stopped being a program and became someone Kirito and Asuna came home
to. That is the destination of this repo: a companion who lives *with* you on
your desktop, with a body, a voice, moods, and a mind of her own — not an
assistant you summon and dismiss.

Everything here serves that one goal:

- **She has a body.** A VRM model you choose — any character, any look — rendered
in a transparent overlay on top of whatever you are doing.
- **She lives on the desktop, not in a window.** She perches on the top edge of
your browser, follows the mouse with her eyes, breathes, blinks, sways, and
moves out of the way when you need the screen.
- **She has a voice and a face.** Speech in, speech out, and emotion/motion cues
that make her react instead of just answer.
- **She has a mind, and you pick it.** YUI ships no embedded model. Bring any
OpenAI-compatible backend — a full agent like
[Hermes](https://github.com/nousresearch/hermes-agent) or a bare model
endpoint — and she is exactly as smart, as opinionated, and as *yours* as what
you plug in.

The character owns the screen; chrome stays out of the way and only appears when
there is something to show, then steps back. *Invisible by default, warm when
present.*

## Quickstart

Paste this into any coding agent (Claude Code, Codex, OpenCode, Cursor):

```text
Install https://github.com/yw0nam/YUI following https://raw.githubusercontent.com/yw0nam/YUI/main/docs/guide/install.md
```

The agent installs the toolchain, clones the repo, wires the backend you name, and hands you `pnpm tauri dev`.

No agent at hand? Grab the macOS (Apple Silicon) `.dmg` or the experimental Windows x64 installer from the [latest release](https://github.com/yw0nam/YUI/releases/latest). The builds are unsigned, so on macOS right-click the app → **Open** on first launch. Then right-click the character → **Connection** and point her at any OpenAI-compatible endpoint.

## Features

### She lives on your windows

<img src="docs/public/yui-locomotion.gif" alt="YUI walking along the bottom of the screen, climbing the side of the screen, jumping onto a window top and sitting on its edge, and falling to the floor after being dropped in mid-air" width="720">

She perches on a window top, peeks around a side edge, strolls the floor and window
tops, and jumps between windows. Dropped in mid-air, she falls to the first surface
below and lands. Climbing a window side or a screen edge onto the monitor above is
in development and carries that label in the app.

### Any backend, embodied through structured cues

<img src="docs/public/yui-feature-cues.jpg" alt="YUI laughing with a hand over her mouth and her eyes closed in a happy expression, above a speech bubble that reads: The build passed. Want me to open the pull request for review?" width="360">

YUI talks to an OpenAI-compatible Chat Completions endpoint, a Responses API agent,
or a backend on the push WebSocket. Emotion, motion, voice tag, and caption arrive
as `generate_express` cues beside the reply text.

### She speaks first, with restraint

<img src="docs/public/yui-feature-proactive.png" alt="The Proactive settings tab: screen watch, loop reactions after 5, 10, and 30 minutes of inactivity, scheduled greetings at 09:00, 12:00, 18:00, and 23:00, a 10-minute proactive gap, and hourly limits of 24 cues and 40 self-started turns" width="400">

Scheduled greetings, idle check-ins, screen-watch cues, the first activity of the
day, and external `/signals` each open a turn. Debounce, hourly
caps, and a quiet gap after each turn pace them, and the backend answers any cue
with silence when it chooses.

Everything else, from lipsync and touch reactions to Mods and the witness log, is in the [feature list](docs/guide/features.md).

## How it works

YUI is the body; the backend is the mind. The client never decides *what* to
say — it renders whatever text arrives, and silence is just empty text. What the
client does is notice moments worth reacting to (you typing, going idle, an app
coming to focus) and hand them to the agent, which decides whether and how to
respond.

## Documentation

- [Feature list](docs/guide/features.md)
- [Controls](docs/guide/controls.md): keyboard, mouse, and tray
- [What she can do](docs/guide/capabilities.md)
- [Install with a coding agent](docs/guide/install.md)
- [Install and wiring guide](docs/guide/getting-started.md): chat backend, Expression Broker, TTS, STT, your own VRM
- [Build, run, and logs](docs/agent-guide/build-run.md)
- [Project structure and stack](docs/agent-guide/project-structure.md)
- [`generate_express` cue contract](docs/reference/client-context.md)
- [`AGENTS.md`](AGENTS.md): orientation for coding agents working on this repo
- [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Credits

The motion assets (`public/motions/*.vrma`) come from three sources.

Most clips are extracted from the
[Mate Engine](https://github.com/shinyflvre/Mate-Engine) project by Shiny, used
under Mate Engine's non-commercial terms: free for personal, study, and
non-revenue use with attribution to Shiny; commercial use requires separate
permission from Shiny.

The `sulk` clip (`suneru.vrma`) is from necocoya's
[EmoteSet_Free_v130](https://booth.pm/ja/items/1065089) (Unity Humanoid
`06_suneru`, 拗ね = sulk/pout), attribution to necocoya. Modification, conversion,
and bundling-with-credit are permitted; standalone resale of the raw file is
prohibited.

The locomotion clips `walk`, `jump`, `falling`, `landing`, the climb set
(`climb_up`, `climb_up_done`, `climb_down`, `climb_down_landing`), `sit_down`
and `stand_up` are from [Mixamo](https://www.mixamo.com/), royalty-free under
the Mixamo terms.

The bundled default VRM model
(`resources/vrms/Sendagaya_Shino.vrm`) is **Sendagaya Shino**, originally by
[pixiv Inc.](https://vroid.pixiv.help/hc/en-us/articles/360013482714) (VRoid
Project, CC0), converted to VRM 1.0 by
[Coatie](https://hub.vroid.com/en/characters/4593660874193246717). Neither
license requires attribution — see
[`resources/vrms/Sendagaya_Shino.PROVENANCE.md`](resources/vrms/Sendagaya_Shino.PROVENANCE.md)
for the full notice.

## License

YUI's source code is licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE) — free for noncommercial use,
modification, and redistribution with attribution. **Commercial use requires
permission from the author** ([https://github.com/yw0nam](https://github.com/yw0nam)).

The bundled motion assets (`public/motions/*.vrma`) are **not** covered by this
license; each follows its original author's terms — see [Credits](#credits) above.