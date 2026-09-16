---
name: yui-platform-install
description: "Install, verify or repair the yui platform plugin on a Hermes host — the WebSocket a YUI client connects to. Triggers on a first install, a client that cannot connect, a socket closing with 4401, or a reply spoken with no expression."
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

Installs the platform plugin at `integrations/hermes/platform/yui/` in the YUI repository. It
serves the WebSocket a YUI client opens, turns each `turn` frame into a gateway message, and sends
the agent's reply back as a `render` frame.

Run the steps in order. Each ends with a check that is a command and its expected output; when one
fails, stop there and report it. Link the plugin, so `git pull` in the checkout updates it in
place.

Repairing rather than installing: the symptom table below names the step that owns each failure.

Replace `$YUI` with the absolute path of the YUI checkout and `<profile>` with the Hermes profile
name. Every `hermes` command takes `-p <profile>`; without it the CLI acts on the global
`~/.hermes` store.

## 1. Checkout

```bash
cd $YUI && git pull --ff-only
grep '^kind:' integrations/hermes/platform/yui/plugin.yaml
```

Check: prints `kind: platform`.

## 2. Link the plugin

The gateway reads plugins from `~/.hermes/plugins/` and from
`~/.hermes/profiles/<profile>/plugins/`. The profile directory keeps the plugin off every other
profile on the host:

```bash
mkdir -p ~/.hermes/profiles/<profile>/plugins
ln -sfn $YUI/integrations/hermes/platform/yui ~/.hermes/profiles/<profile>/plugins/yui
ls -L ~/.hermes/profiles/<profile>/plugins/yui/plugin.yaml
```

The directory name is the plugin id, so keep it `yui`.

Check: the `ls` prints the path.

## 3. Configure the platform

Three top-level blocks in `~/.hermes/profiles/<profile>/config.yaml`:

```yaml
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
of it falls back to a default toolset, and its replies arrive as speech with no cues.

`README.md` beside this skill carries what each `extra` key means and what to change for a host
other than loopback.

```bash
python3 -c "import yaml,os;d=yaml.safe_load(open(os.path.expanduser('~/.hermes/profiles/<profile>/config.yaml')));print(d['platforms']['yui']['enabled'],d['platform_toolsets']['yui'],'yui' in d['plugins']['enabled'])"
```

Check: prints `True ['hermes-cli', 'delegation', 'yui'] True`.

## 4. Set the key

A `hello` on a loopback `host` is accepted with no key set, and a `host` reachable from elsewhere
is refused until one is set. Set it under the same `extra` block, to the value the client sends:

```yaml
      extra:
        key: "<the value the client sends>"
```

`YUI_PLATFORM_KEY` in the profile `.env` sets it from the environment instead.

Check: step 7's ready line appears. A socket closing with `4401` is this step.

## 5. Keep the reply free of gateway text

This client speaks its replies aloud, so two `display` settings keep the gateway's own text out of
the spoken reply:

```yaml
display:
  platforms:
    yui:
      show_reasoning: false
  runtime_footer:
    enabled: false
```

```bash
python3 -c "import yaml,os;d=yaml.safe_load(open(os.path.expanduser('~/.hermes/profiles/<profile>/config.yaml')));print(d['display']['platforms']['yui']['show_reasoning'],d['display']['runtime_footer']['enabled'])"
```

Check: prints `False False`.

A client that shows a reasoning chip wants the live stream as well, one switch global to the
gateway:

```yaml
plugins:
  stream_reasoning_deltas: true
```

With it on the `render` frame carries the streamed text; with it off it carries the block the
gateway rendered into the reply, cut to fifteen lines.

## 6. Restart the gateway

The gateway imports the platform adapter at startup, so a fresh link or a config change takes
effect on the next start. The restart ends every running turn, including the one that issues it,
so answer first and issue it detached:

```bash
setsid nohup sh -c 'sleep 30; hermes -p <profile> gateway restart' >/dev/null 2>&1 &
sleep 45 && ss -ltn | grep :8646
```

Check: the `grep` prints a listening line.

## 7. Point the client at it and send one turn

In the client set `chat_api` to `push` and `chat_base_url` to this server, in
`configs/endpoints.json` or from the settings panel's chat provider dropdown. The client appends
the path: `http://host:8646` gives `ws://host:8646/ws`, and `https://host:8646` gives
`wss://host:8646/ws`.

Send one message, then read the gateway log:

```bash
grep -E "client ready|turn accepted" ~/.hermes/profiles/<profile>/logs/gateway.log | tail -3
```

Check: a `yui: client ready chat=yui-<id>` line, then a `yui: turn accepted chat=… turn_id=…
chars=…` line carrying the turn id the client sent. The character speaks the reply with an
expression.

## Symptoms

| What you see | Step that owns it |
|---|---|
| The socket closes with `4401` | 4 |
| The reply is spoken flat, with no expression or motion | 3, `platform_toolsets.yui` |
| Nothing is listening on the port | 6 |
| The gateway log never mentions `hermes_plugins.yui` | 2, then 3 |
| The model name and working directory are read out | 5, `runtime_footer` |
| The reasoning is read out as part of the reply | 5, `show_reasoning` |
| The client connects, and a turn draws no reply | the client's own wait, `docs/reference/push-transport.md` |

## Tests (optional, needs uv)

```bash
cd $YUI/integrations/hermes/platform/yui && uv sync && uv run pytest && uv run ruff check .
```

The tests stub the gateway modules, so they run without a gateway process.
