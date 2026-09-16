---
name: yui-platform-install
description: "Install, update, or verify the yui platform plugin (the push-transport WebSocket the YUI client connects to) on this Hermes host: plugin link, platform config, toolset, key, display settings, gateway restart, and the client end of the socket."
version: 0.1.0
author: yw0nam
platforms: [linux, macos]
prerequisites:
  commands: [git, hermes, python3]
metadata:
  hermes:
    tags: [yui, platform, push, install, websocket]
---

# yui platform install

Installs the platform plugin that lives in the YUI repository at `integrations/hermes/platform/yui/`.
It serves the WebSocket the YUI client opens, turns each `turn` frame into a gateway message, and
sends the agent's reply back as a `render` frame. The contract both ends speak is
`docs/reference/push-transport.md` in the same repository.

Run every step in order; each step ends with a check. Link the plugin, so `git pull` in the
checkout updates it in place.

Replace `$YUI` with the absolute path of the YUI checkout and `<profile>` with the Hermes profile
name. Every `hermes` command takes `-p <profile>`; without it the CLI acts on the global
`~/.hermes` store.

## When to use

- First-time install of the push transport for this profile.
- After `git pull` in the checkout, when the client stops connecting or the reply arrives without
  expression (steps 5 and 6).
- When the client reports a `4401` close, which is the key gate (step 4).

## 1. Checkout

```bash
cd $YUI && git pull --ff-only && git log -1 --oneline
```

Check: `integrations/hermes/platform/yui/plugin.yaml` exists and names `kind: platform`.

## 2. Plugin link

The gateway reads plugins from two directories. A profile-scoped install keeps the plugin off
every other profile on the host:

```bash
mkdir -p ~/.hermes/profiles/<profile>/plugins
ln -sfn $YUI/integrations/hermes/platform/yui ~/.hermes/profiles/<profile>/plugins/yui
```

For a host where every profile should see it, use `~/.hermes/plugins/yui` instead. Either way the
directory name is the plugin id, so keep it `yui`.

Check: `ls -L ~/.hermes/profiles/<profile>/plugins/yui/plugin.yaml` prints the path.

## 3. Platform config

Three blocks in `~/.hermes/profiles/<profile>/config.yaml`:

```yaml
gateway:
  platforms:
    yui:
      enabled: true
      extra:
        host: 127.0.0.1
        port: 8646

platform_toolsets:
  yui: [hermes-cli, delegation, yui]

plugins:
  enabled:
    - yui
```

`platform_toolsets.yui` is what puts `generate_express` in front of the model. A platform left out
of it falls back to a default toolset, and its replies arrive as speech with no cues. The `yui`
toolset is this plugin's own; `hermes-cli` carries the general tools and `delegation` carries
`delegate_task`.

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1` | Bind address of the WebSocket server |
| `port` | `8646` | Port of the WebSocket server |
| `key` | unset | Key the `hello` frame must carry, see step 4 |

Check: `python3 -c "import yaml;d=yaml.safe_load(open('$HOME/.hermes/profiles/<profile>/config.yaml'));print(d['gateway']['platforms']['yui']['enabled'], d['platform_toolsets']['yui'])"`
prints `True ['hermes-cli', 'delegation', 'yui']`.

## 4. Key

With no key set, a `hello` on a loopback `host` is accepted and a `host` reachable from elsewhere
is refused. Set a key before the port leaves loopback, under the same `extra` block:

```yaml
      extra:
        key: "<the same value the client sends>"
```

`YUI_PLATFORM_KEY` in the profile `.env` sets it from the environment instead. The client carries
the same value in its `hello` frame; a mismatch closes the socket with code `4401` and the client
stops retrying until the setting changes.

Check: the key the client holds and the key the profile holds are the same string. A `4401` in the
client's log after step 7 means they are not.

## 5. Display settings

Both belong under `display`, and both exist because this client speaks its replies aloud:

```yaml
display:
  platforms:
    yui:
      show_reasoning: false
  runtime_footer:
    enabled: false
```

With `show_reasoning` on, the gateway prepends the reasoning to the reply text and the plugin has
to strip it back off. With `runtime_footer` on, the model name and working directory are
concatenated into the reply and get read out loud.

Check: both read `false` in the profile config.

The live reasoning stream is a separate switch, global to the gateway and off by default. Turn it
on for a client that shows the reasoning chip:

```yaml
plugins:
  stream_reasoning_deltas: true
```

With it on the client receives the reasoning as it is written and the `render` frame carries the
streamed text. With it off the `render` frame carries the block the gateway rendered into the
reply, cut to fifteen lines.

## 6. Gateway restart

The gateway imports the platform adapter at startup, so a fresh link or a config change takes
effect on the next start. The restart ends every running turn, including the one that issues it,
so answer first and issue it detached:

```bash
setsid nohup sh -c 'sleep 30; hermes -p <profile> gateway restart' >/dev/null 2>&1 &
```

Check: the port is listening.

```bash
ss -ltn | grep :8646
```

## 7. The client end

In the YUI client, set `chat_api` to `push` and point `chat_base_url` at this server, either in
`configs/endpoints.json` or from the settings panel's chat provider dropdown. The client appends
the path itself: `http://host:8646` gives `ws://host:8646/ws`, and `https://host:8646` gives
`wss://host:8646/ws`.

Reaching the host from another machine: forward the WebSocket port and only that port. The
gateway's own API server is a separate service and this transport never uses it. Most tunnels
carry the upgrade on an ordinary HTTPS route, so the tunnel host alone works as
`chat_base_url`. Keep `host` at `127.0.0.1` with the tunnel connecting locally, and set the key in
step 4 first.

Check: the gateway log gains a ready line when the client connects.

```bash
grep "client ready" ~/.hermes/profiles/<profile>/logs/gateway.log | tail -1
```

prints a line of the shape
`INFO hermes_plugins.yui.adapter: yui: client ready chat=yui-<id>`.

## 8. Verify a turn

Send one message from the client and read the same log:

```bash
grep -E "turn accepted|yui:" ~/.hermes/profiles/<profile>/logs/gateway.log | tail -5
```

Check: a `yui: turn accepted chat=… turn_id=… chars=…` line carries the turn id the client sent,
and the character speaks the reply with an expression. A reply spoken flat, with no expression and
no motion, points at `platform_toolsets.yui` in step 3.

## Tests (optional, needs uv)

```bash
cd $YUI/integrations/hermes/platform/yui && uv sync && uv run pytest && uv run ruff check .
```

The tests stub the gateway modules, so they run without a gateway process.
