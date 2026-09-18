# YUI platform plugin for Hermes Agent

Connects a YUI client to a Hermes gateway over the push transport: one WebSocket that carries
turns in and finished replies out. The contract both sides speak is
[`docs/reference/push-transport.md`](../../../../docs/reference/push-transport.md).

## What it does

- Serves `ws://<host>:<port>/ws`. The client sends `hello` with its key, its `chat_id` and the
  vocabulary it can render; the plugin answers `ready` and keeps the socket open.
- Turns the `turn` frame into a gateway message: the rendered `client_context` block, a blank
  line, then the user's utterance.
- Registers `generate_express`, whose enums are the emotion ids, motion ids and voice-tone tags
  the client published. The model calls it once per reply, listing every cue in speaking order
  and naming the sentence each one belongs before.
- Sends the answer while the agent writes it: each finished sentence leaves as a `speech` frame
  carrying every cue whose `sentence` opens it, or else the next cue that names no sentence. The
  reply the gateway sends then leaves as a `render` frame carrying the sentences not yet sent, each
  with the cues that landed on it, and cues left over after streamed speech still play. A reply
  that does not continue the streamed text renders whole. A turn the agent answers with
  `[SILENT]`, or with nothing, closes with no speech, and the cues it placed still play.
- Logs and never renders the text the gateway writes for itself: the busy acknowledgement when
  a turn lands mid-run, every status notice, and the restart, startup and shutdown pings, which
  the plugin turns off for this platform. What the agent writes before a tool call, its final
  reply, and its answer to a delegation report all render as usual, and so does the gateway's
  notice that a turn failed, which reaches the plugin in the same shape as the agent's words. The
  failed turn ends behind that notice.
- Streams the agent's reasoning to the client as `reasoning` frames, coalesced to one frame per
  100 ms. The `render` frame carries the reasoning written so far for its turn, which on the
  reply that ends the turn is the whole text. The gateway offers the live tokens only while
  `plugins.stream_reasoning_deltas` is `true`; with it off, the `render` frame carries no
  `reasoning`.
- Never delivers audio, images, video or files. `voice.auto_tts` is off for this platform, and
  the audio a `/voice all` chat still makes is discarded. The client speaks the reply itself.
- Makes the first chat that connects the platform's home channel, which is where the gateway
  delivers cron results and cross-platform messages.
- Reads the answer from the gateway's `on_stream_delta` hook, so the gateway's `streaming` setting
  does not apply to this platform. The hook names no chat, so the answer streams to the sole
  connected client. Text a background review streams is not spoken. The gateway drops a newline
  that opens a streamed chunk, so a line that does not end in a CJK terminator runs into the next
  line with no space between them, and a cue that names that next line plays later in the reply.
  A provider retry in the middle of an answer streams its text again, so `speech` frames can repeat
  sentences. Deltas the gateway's hook queue drops under load leave a gap, and the `render` can then
  repeat the whole answer. A hook queue that falls a whole turn behind speaks that turn's text under
  the next turn.
- Never holds a `speech` frame for a client that is away. A client that disconnects mid-answer, or
  connects while a turn runs, gets the rest of that turn in its `render`. The same holds for a turn
  whose text streams while no single client is connected, while the reset acknowledgement is still
  unspoken, or after a `speech` frame fails to send.
- Names the most recently opened turn in every reply of a run, and clears the name when the turn
  ends. A turn the gateway runs inside a turn it interrupted ends first, and the interrupted turn
  ends behind it. A turn whose text the gateway takes into a turn already running on the same chat
  ends when that turn ends. A turn the gateway started on its own, such as a cron result, carries an
  id the plugin mints, of the form `hermes-<n>`, counted per gateway process.
- Sends a `delegations` frame whenever background work starts or finishes, so the client can show
  what is running; each finished item carries its `status` and `summary`. The plugin holds fifty
  items per chat, dropping the oldest finished one past that, and drops summaries oldest-first
  from a frame over the size limit.
- Sends a `tool_status` frame from the gateway's `pre_tool_call` and `post_tool_call` hooks for
  each tool call of an open YUI turn, so the client can show and name the tool in use. A frame for
  a chat with no connected client or no open turn is dropped, never held and never retried.
  `generate_express` sends none, and neither does a tool call a delegated child makes.
- Holds reports that arrive while the client is away, up to forty, and delivers them as one
  summary turn when it connects again. A reply that finishes while the client is away is held the
  same way and sent first when it reconnects. Both live in memory, so a gateway restart while the
  client is away drops them.
- Starts a new conversation on `reset` and ends the delegations still running for that chat. The
  gateway asks to confirm `/new`, and the plugin approves it because the client already did.
- Declares the `generate_express` schema when a turn opens, from the vocabulary that turn's chat
  published. The gateway holds one schema per process, and a turn reads it when its agent is built
  and again when it compacts its context, so a turn that reaches either point after another chat's
  turn opened runs with the other chat's ids. Each switch between chats whose vocabularies differ
  rebuilds the gateway's cached agents.

## Install

[`skills/yui-platform-install/SKILL.md`](skills/yui-platform-install/SKILL.md) walks a host through
the whole install, one checked step at a time. The rest of this section is the reference the skill
draws on.

The gateway loads plugins from `~/.hermes/plugins/`, and from
`~/.hermes/profiles/<profile>/plugins/` for one profile alone. Link this directory in:

```bash
ln -s "$PWD/integrations/hermes/platform/yui" ~/.hermes/plugins/yui
```

A copy works the same way. The directory name is the plugin id, so keep it `yui`.

## Enable

Three top-level blocks in the config the profile reads, `~/.hermes/profiles/<profile>/config.yaml`
for a profile install and `~/.hermes/config.yaml` for the global one:

```yaml
plugins:
  enabled:
    - yui

platforms:
  yui:
    enabled: true
    extra:
      host: 127.0.0.1
      port: 8646
      key: "<the same chat API key the client sends>"

platform_toolsets:
  yui: [hermes-cli, delegation, yui]
```

`platform_toolsets.yui` has to be listed: without it the platform falls back to a default toolset
and the model never sees `generate_express`. The `yui` toolset is this plugin's own; `hermes-cli`
carries the general tools and `delegation` carries `delegate_task`.

MCP servers reach the platform through the same list. With no MCP server named the platform gets
every enabled one, with any named it gets only those, and `no_mcp` gives it none. The list above
names none, so a profile that carries the Expression Broker MCP server hands the broker to the
platform. Name the MCP servers the character uses there, or add `no_mcp` when it uses none, because a
cue sent through the broker's `generate_express` never reaches a `render` frame.

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1` | Bind address of the WebSocket server |
| `port` | `8646` | Port of the WebSocket server |
| `key` | unset | Key the `hello` frame must carry. `YUI_PLATFORM_KEY` sets it from the environment. With no key set, any `hello` on a loopback `host` is accepted; a `host` reachable from elsewhere is refused until a key is set |

Set `chat_api: "push"` in the client and point `chat_base_url` at this server. A
`chat_base_url` of `https://host:8646` gives `wss://host:8646/ws`.

One display setting is required for a voice client, under `display.platforms.yui`: set
`show_reasoning: false`, because with it on the gateway prepends the reasoning to the reply text
and the reasoning gets spoken.

```yaml
display:
  platforms:
    yui:
      show_reasoning: false
```

The runtime footer is off by default, and its switch is global to the gateway at
`display.runtime_footer.enabled`. Turned on, the footer is concatenated into the reply text, so
the model name and working directory get spoken. Leave it off.

The live reasoning stream is a separate switch, off by default and global to the gateway:

```yaml
plugins:
  stream_reasoning_deltas: true
```

With it on the client receives the reasoning as it is written, and the `render` frame carries the
streamed text.

Run the plugin from the same commit as the client: the frames carry no version field.

## Reaching it from outside the machine

Expose the WebSocket port, and only that port: the gateway's own API server is a separate
service and this transport does not use it. Most tunnels forward WebSocket upgrades on an
ordinary HTTPS route, so `https://<tunnel-host>` as `chat_base_url` is enough. Keep `host` at
`127.0.0.1` with the tunnel connecting locally, and set `key` before the port leaves loopback.

## Development

```bash
uv sync
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
```

The tests stub the gateway modules (`tests/gateway_stub.py`), so they run without a gateway
process. [`skills/yui-platform-smoke-test/SKILL.md`](skills/yui-platform-smoke-test/SKILL.md) runs
the checkout's plugin on a live gateway under a throwaway profile, with two clients.
