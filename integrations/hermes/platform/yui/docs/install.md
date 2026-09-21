# Install

[`skills/yui-platform-install/SKILL.md`](../skills/yui-platform-install/SKILL.md) walks a host through
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
