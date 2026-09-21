# YUI platform plugin for Hermes Agent

Connects a YUI client to a Hermes gateway over the push transport: one WebSocket that carries
turns in and finished replies out. The contract both sides speak is
[`docs/reference/push-transport.md`](../../../../docs/reference/push-transport.md).

## Layout

The plugin root is the package the gateway loads: `__init__.py` holds `register`, the platform
hint and the readiness probes, beside `plugin.yaml` and the uv project files.

| Path | Holds |
|---|---|
| `src/transport/` | `adapter.py`, the WebSocket server and the frames on it |
| `src/turns/` | The per-chat turn state and the session lookup that finds its chat |
| `src/express/` | The client vocabulary, the `generate_express` tool, and cue placement on sentences |
| `src/speech/` | The streamed answer, cut into the sentences `speech` frames carry |
| `src/activity/` | Reasoning, tool status, delegations, and the away-report queue |
| `skills/` | The install and smoke-test skills |
| `tests/` | The suite, run against stubbed gateway modules |

## Documentation

- [What it does](docs/behaviour.md) — the frames, the streaming rules and the gateway behaviour
  this platform overrides.
- [Install](docs/install.md) — linking the plugin in, the config blocks that enable it, and
  reaching it from outside the machine.
- [Development](docs/development.md) — the test and lint commands, and the live smoke test.
