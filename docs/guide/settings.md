# Settings

The settings window opens from **Settings…** in the tray menu, or from **All settings…** on the quick card that a right-click opens.
The strip at the top picks which character the window edits, and its note line says where a change shows: in main, in that character's own window, or when it opens.
The search box above the rail filters the rows on every page, and the rail carries two groups: the pages for the character you edit, and the pages for every character.

## Connection

Sets the chat connection, speech recognition, and speech synthesis for the character you edit. An empty field uses the bundled default. [Connect a backend](connect-a-backend.md) covers the chat protocols, and [Voice in and out](voice.md) covers the speech services.

| Setting | What it does |
| --- | --- |
| Type | The chat protocol: Chat Completions, Responses, or Push. The line under it explains what the pick carries |
| Provider | The chat preset: OpenAI, Ollama, LM Studio, Groq, Hermes Agent, or Custom, which fills the chat server URL. Under TTS, Provider picks Irodori, OpenAI, or Fish Audio and fills that URL and model |
| Chat server URL and Chat model | The chat endpoint and the model id sent with each turn. The model list reads from the server |
| Chat API key and TTS API key | Keys saved for this character. An empty field uses the build-time key |
| Reasoning effort | Default, None, Minimal, Low, or Medium, the depth of thought before an answer. Push disables it because the backend decides |
| Speech recognition (STT) server URL, STT model, and STT language | The transcription endpoint, its model, and a language hint. An empty language auto-detects. The STT key is on Listening and bubble |
| Speech synthesis (TTS) server URL and TTS model | The speech endpoint and the model that serves it |
| Reset Chat, Reset STT, and Reset TTS | Clears that service's fields. Reset Chat and Reset TTS clear its key too |

## Voice

Sets how she speaks and what she says while a reply is on its way. [Voice in and out](voice.md) covers the speech services.

| Setting | What it does |
| --- | --- |
| Voice output | Reads replies aloud with TTS. Off shows text only |
| Speaker | The voice list. Preview plays a sample, In use marks the selected voice, and Add from file… imports your own clip. Rename and Delete apply to voices you added |
| Use interjections | Says short lines while a reply is on its way |
| Language | The language of the interjection lines: 日本語, English, or 한국어 |
| First line and Repeat lines | First line plays once when your message arrives. Repeat lines replay with growing pauses |
| More phrases | Reveals Long wait line, Timeout line, Connection lost line, and Tool lines. A list left empty uses its default phrases |
| Separate message window | Moves speech and typing into a draggable window. The row is hidden outside the desktop app and locked off while the unified chat window shows |

## Persona

Holds the card of the character you edit. [Cards](cards.md) explains every field.

| Setting | What it does |
| --- | --- |
| Send card | Sends her persona to the backend as the system prompt. Push disables it because the backend uses its own persona |
| Name | Her name. It renames the preset, so the strip shows the same name |
| Description, Personality, Scenario, and Greeting | The card fields the backend reads |
| Add greeting | Appends an alternate greeting, each with its own Remove |
| Advanced | Reveals Example dialogue, System prompt, and Post-history instructions |
| Import card… and Export card | Imports a JSON or PNG card as a new preset, and writes the current card as V2 JSON |
| Reset to default | Returns the preset to the default card in the UI language |

## Body

Picks the model that renders the character, sets how she feels toward the others, and moves the camera.

| Setting | What it does |
| --- | --- |
| VRM | The model list. In use marks the active model, and Rename and Delete apply to models you added |
| Add from file… | Imports a `.vrm` model |
| Relations | One slider per target, starting with you. Drag it to set how she feels toward that target. The section is hidden while the Relations switch on Together is off |
| Reset to front | Returns the camera to its default view. Shift + drag orbits and the wheel zooms |

## History

Lists the conversation as it was said, session by session, and keeps it on this device. The page appears only when the app has a conversation transcript.

| Setting | What it does |
| --- | --- |
| Current conversation | The open session, each turn with its speaker, text, and time |
| Earlier sessions | The same list, folded. Open one to read its turns |
| Reset conversation | Starts a new conversation. Earlier turns stay in the list |
| Context | The tokens in the conversation against the window, with a percentage and a meter |
| Delegated tasks | Work she handed to a background agent, with its state and time |

## Together

Sets what happens when more than one character stands on the desktop.

| Setting | What it does |
| --- | --- |
| Unified chat | With two or more characters open, one window takes your messages. A cast chip or a leading `@name` picks who answers, else the last speaker |
| One voice at a time | Another character waits until this one finishes its turn |
| Relations | Turns relations on or off for every character. Off hides the sliders on Body and keeps the stored values |
| Answers to another character, in a row | How many times she answers a character who addressed her before you speak again |
| Characters | Each character's On the desktop switch opens or closes its own window. In main · always on marks the main character, and up to 4 stand on the desktop at once |

## Listening and bubble

Turns her ears on and sets how the speech bubble behaves.

| Setting | What it does |
| --- | --- |
| Voice input | While on, speech is transcribed when you stop and sent as your message |
| STT API key | The key for the speech recognition server set on Connection |
| Silence threshold | How long to wait after speech ends before sending |
| Barge-in | She stops speaking when you start |
| Keep bubble until dismissed | The speech bubble stays until you close it |
| Reading dictionary | `word=reading` pairs that change how the voice reads a word, never the bubble text. Case-sensitive, and the longest word wins |

## Permissions

Sets what she may see of your screen.

| Setting | What it does |
| --- | --- |
| Attach screenshot | While on, this screen goes with every message. Off by default |
| Screen to send | The display to capture. The list loads while Attach screenshot is on |
| Allow screen requests | While on, she may look at your screen when she asks to. Off by default |

## Plugins

Installs MCP servers and skills that the backend of every character can use. The page appears only in the desktop app, where the plugin host runs. [Plugins](plugins.md) walks through install, consent, update, and removal.

| Setting | What it does |
| --- | --- |
| Installed plugins | One row per plugin with a switch. The switch starts or stops its servers, and the first turn-on asks for consent |
| `Tools: n` and `Tools: n, skills: m` | The disclosure that lists the tools and skills every character's backend sees |
| Log | The plugin's last log lines, with Open log folder |
| `Update to v<version>` | Installs the catalog version. A community update needs Allow again… |
| Delete and Remove from list | Deletes a catalog plugin's code and data, or removes a local entry and keeps its folder. Both ask first |
| Check for updates | Reloads the catalog and reports Updates: n or All up to date |
| Available plugins | Install unpacks a catalog release, and Add from folder… adds a local folder as it is |
| Official, Community, and Local | The source badge of a plugin, and whether anyone reviewed it |

## Proactive

Holds the rules for when she speaks first, and the workflows she fires on demand. [Features § Proactive and context](features.md#proactive-and-context) lists what these settings produce.

| Setting | What it does |
| --- | --- |
| React to screen changes | Notices app switches and long stretches, then speaks first. Screen pixels still follow Attach screenshot on Permissions |
| Screen watch timings | Minimum gap between cues, Counts as an app switch after, New app settles after, Notices a long stretch every, Stay quiet after a turn for, and Remembers up to |
| Loop reaction | Check-ins on a repeating schedule while you are quiet at work. Each row holds Inactive minutes, a Name, a Context, and Delete |
| Scheduled greeting | Greets you first at the set Greeting time |
| External signals | Speaks up when a coding agent, workflow, or other local program sends a signal. Listener port and Ingress URL give a producer its address |
| Workflows | ▶ fires a saved URL, and the first run doubles as a connection test. Label, URL, and Add save one |
| Proactive gap and Present when idle for | The quiet gap after any turn before she speaks first, and the idle gap that still counts as present |
| Limits | Cues per hour, Urgent signal turns per hour, and Total self-started turns per hour. An empty field uses the shipped default |

## Motion and desktop

Sets how she moves, how she climbs and falls, and how the window spends power.

| Setting | What it does |
| --- | --- |
| Mouth movement | How wide the mouth opens with voice volume. Dragging it previews the change |
| Idle motion | One switch per idle variant. The baseline is always on |
| Expression motion | The motions she may pick while talking, under Emotional reactions, Actions · states, and Other. Turning one off drops it from her vocabulary |
| Wake up in bed and Wakes on her own after | Starts her asleep on a bed at launch, and the seconds before she wakes |
| Follow cursor | Her eyes and head follow the mouse |
| Window climbing | She climbs onto other windows from time to time, in development |
| Falling | Released in mid-air, she falls to the window or floor below |
| Power saving when idle (30fps) | Lowers the frame rate while she is still, and smooths out when she speaks or moves |

## General

Holds the device-wide settings for the app, plus the two Help entries.

::: v-pre

| Setting | What it does |
| --- | --- |
| Language | 日本語, English, or 한국어. The whole panel reloads on a change |
| Appearance | Dawn for light glass, Hearth for the dark scrim, or Follow system |
| Your name | The name `{{user}}` stands for, shared by every preset |
| Developer Tools | Open shows the DevTools window with the context inspector and the motion preview |
| Help: Controls and What she can do | Ask starts her walkthrough of the shortcuts, or of what you can do together |

:::
