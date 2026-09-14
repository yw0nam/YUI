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
  an empty `segments` list.
- Sends a `delegations` frame whenever background work starts or finishes, so the client can show
  what is running.
- Holds reports that arrive while the client is away, up to twenty, and delivers them as one
  summary turn when it connects again.

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
| `key` | unset | Key the `hello` frame must carry. `YUI_PLATFORM_KEY` sets it from the environment. With no key set, any `hello` is accepted, which is why the default bind is loopback |

Set `chat_api: "push"` in the client and point `chat_base_url` at this server. A
`chat_base_url` of `https://host:8646` gives `wss://host:8646/ws`.

## Reaching it from outside the machine

Expose the WebSocket port, and only that port: the gateway's own API server is a separate
service and this transport does not use it. Most tunnels forward WebSocket upgrades on an
ordinary HTTPS route, so `https://<tunnel-host>` as `chat_base_url` is enough. Set `key` before
the port leaves loopback, and keep `host` at `127.0.0.1` with the tunnel connecting locally.

## Development

```bash
uv sync
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
```

The tests stub the gateway modules (`tests/gateway_stub.py`), so they run without a gateway
process.
