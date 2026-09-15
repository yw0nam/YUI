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
- Sends the final reply as a `render` frame: the speech split into sentences, each carrying the
  cues that landed on it. A turn the agent answers with `[SILENT]`, or with nothing, closes with
  no speech, and the cues it placed still play.
- Logs and never renders the text the gateway writes for itself: the busy acknowledgement when
  a turn lands mid-run, every status notice, and the restart, startup and shutdown pings, which
  the plugin turns off for this platform. What the agent writes before a tool call, its final
  reply, and its answer to a delegation report all render as usual, and so does the gateway's
  notice that a turn failed, which reaches the plugin in the same shape as the agent's words.
- Streams the agent's reasoning to the client as `reasoning` frames, coalesced to one frame per
  100 ms. The `render` frame carries the reasoning written so far for its turn, which on the
  reply that ends the turn is the whole text. The gateway offers the live tokens only while
  `plugins.stream_reasoning_deltas` is `true`; with it off, the `render` frame carries the block
  the gateway rendered into the reply instead, cut to fifteen lines and still carrying the
  gateway's display escaping of any code fence inside it.
- Never delivers audio, images, video or files. `voice.auto_tts` is off for this platform, and
  the audio a `/voice all` chat still makes is discarded. The client speaks the reply itself.
- Makes the first chat that connects the platform's home channel, which is where the gateway
  delivers cron results and cross-platform messages.
- Delivers the reply whole when the turn ends, so the gateway's `streaming` setting does not
  apply to this platform.
- Names the client turn in the first reply of a run only. A reply the agent adds later in the
  same run, such as the answer to a queued follow-up, carries a null `turn_id`.
- Sends a `delegations` frame whenever background work starts or finishes, so the client can show
  what is running.
- Holds reports that arrive while the client is away, up to twenty, and delivers them as one
  summary turn when it connects again. A reply that finishes while the client is away is held the
  same way and sent first when it reconnects. Both live in memory, so a gateway restart while the
  client is away drops them.
- Starts a new conversation on `reset` and ends the delegations still running for that chat. The
  gateway asks to confirm `/new`, and the plugin approves it because the client already did.
- Serves one client at a time: the `generate_express` schema is declared once per process, from
  the vocabulary of the client that published last.

## Install

The gateway loads plugins from `~/.hermes/plugins/`. Link this directory in:

```bash
ln -s "$PWD/integrations/hermes/platform/yui" ~/.hermes/plugins/yui
```

A copy works the same way. The directory name is the plugin id, so keep it `yui`.

## Enable

Two gates in `~/.hermes/config.yaml`, both required:

```yaml
plugins:
  enabled:
    - yui

gateway:
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

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1` | Bind address of the WebSocket server |
| `port` | `8646` | Port of the WebSocket server |
| `key` | unset | Key the `hello` frame must carry. `YUI_PLATFORM_KEY` sets it from the environment. With no key set, any `hello` on a loopback `host` is accepted; a `host` reachable from elsewhere is refused until a key is set |

Set `chat_api: "push"` in the client and point `chat_base_url` at this server. A
`chat_base_url` of `https://host:8646` gives `wss://host:8646/ws`.

Two display settings are worth a look for a voice client, under `display.platforms.yui`. Leave
`runtime_footer.enabled` off, its default: when it is on the footer is concatenated into the reply
text, so the model name and working directory get read out. Set `show_reasoning: false` as well —
with it on the gateway prepends the reasoning, cut to fifteen lines, to the reply text, and the
plugin has to take it back off:

```yaml
display:
  platforms:
    yui:
      show_reasoning: false
```

The live reasoning stream is a separate switch, off by default and global to the gateway:

```yaml
plugins:
  stream_reasoning_deltas: true
```

With it on the client receives the reasoning as it is written, and the `render` frame carries the
streamed text rather than the block the gateway rendered into the reply.

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
process.
