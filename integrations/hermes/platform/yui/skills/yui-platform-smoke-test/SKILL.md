---
name: yui-platform-smoke-test
description: "Smoke-test the yui platform plugin from a YUI checkout on a live Hermes gateway run under a throwaway profile, leaving every other profile untouched. Use when a plugin change needs runtime evidence for its PR, or to check that two clients each keep their own generate_express vocabulary."
---

# yui platform smoke test

Runs the plugin at `integrations/hermes/platform/yui/` from the checkout under test inside a new
Hermes profile, drives two push clients through [`smoke.py`](smoke.py), and deletes the profile.
The profile is bare: it carries the model block and nothing else, so the test reaches no chat
platform, memory provider, cron job or MCP server of the host's real profiles.

Run the steps in order. Each ends with a check; when one fails, stop there and report it. Replace
`$YUI` with the absolute path of the checkout under test, `<profile>` with a new lowercase name,
`<port>` with the port and `<key>` with any throwaway string.

## 1. Pick a free port

```bash
lsof -iTCP:<port> -sTCP:LISTEN -P
```

Check: prints nothing. A tunnel or a running gateway often holds `8646`, and a gateway whose port
is taken starts without its socket.

## 2. Create the profile

```bash
hermes profile create <profile> --no-alias --no-skills
```

Create it bare: `--clone` copies `.env`, whose bot tokens would connect this gateway to the host's
real chat platforms.

Check: `hermes profile list` lists `<profile>`, and `~/.hermes/profiles/<profile>/config.yaml`
starts with a `model:` block.

## 3. Configure the platform

In `~/.hermes/profiles/<profile>/config.yaml`, replace `plugins:` / `  enabled: []` with:

```yaml
plugins:
  enabled:
    - yui
platforms:
  yui:
    enabled: true
    extra:
      host: 127.0.0.1
      port: <port>
      key: <key>
platform_toolsets:
  yui: [yui, no_mcp]
display:
  platforms:
    yui:
      show_reasoning: false
```

`yui` is the only toolset the model needs to place cues, and `no_mcp` keeps an Expression Broker
out of the turn.

Check: `grep -A6 '^platforms:' ~/.hermes/profiles/<profile>/config.yaml` prints the `yui` block
with `<port>`.

## 4. Link the plugin and the model grant

```bash
mkdir -p ~/.hermes/profiles/<profile>/plugins
ln -s $YUI/integrations/hermes/platform/yui ~/.hermes/profiles/<profile>/plugins/yui
ln -s ~/.hermes/auth.json ~/.hermes/profiles/<profile>/auth.json
```

The `auth.json` link shares the host's OAuth grant with the profile; Hermes treats a linked store
as the root store, so the grant stays valid for every profile.

Check: `ls -L ~/.hermes/profiles/<profile>/plugins/yui/plugin.yaml ~/.hermes/profiles/<profile>/auth.json`
prints both paths.

## 5. Start the gateway

Start it in the background:

```bash
hermes gateway run -p <profile>
```

Check: `grep "accepting clients on ws://127.0.0.1:<port>/ws" ~/.hermes/profiles/<profile>/logs/agent.log`
prints a line. `could not bind` in that log means step 1's port is taken.

## 6. Run the smoke test

```bash
cd $YUI/integrations/hermes/platform/yui
uv run python skills/yui-platform-smoke-test/smoke.py --profile <profile> --port <port> --key <key>
```

Client A publishes `motion_ids: [idle_lively, dance]`, client B `[idle_lively]`, both connect
before any turn, and the turns run A, B, A. The script reads the gateway log written during the
run and fails when a turn ends without a `render`, when the `generate_express schema declared`
lines do not name each turn's chat with its own motion count, or when a gate logs `dropped input`.
Each turn takes one model call, so the run needs a minute or more.

Check: the last line is `PASS`. For PR evidence, keep the printed cues and the `yui:` lines of
`~/.hermes/profiles/<profile>/logs/agent.log`.

## 7. Tear down

```bash
hermes gateway stop -p <profile>
hermes profile delete -y <profile>
```

Deleting the profile removes the links it holds, never their targets.

Check: `hermes profile list` omits `<profile>`, `lsof -iTCP:<port> -sTCP:LISTEN -P` prints
nothing, and `ls ~/.hermes/auth.json` prints the path.
