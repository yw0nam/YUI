# router

One HTTP front door that path-routes to every mod, so a single SSH reverse tunnel exposes them all instead of one port per mod. Each mod stays an independent process on its own port — the router only forwards bytes by URL prefix, so the upstream mod can be written in any language:

```
http://host:8080/<mod>/mcp  ->  127.0.0.1:<mod port>/mcp
```

## Run

```bash
cd Mods/router && uv run mods-router --host 127.0.0.1 --port 8080
```

Runs host-native as a thin proxy. MCP's Streamable HTTP transport is SSE, so the router streams responses through unbuffered — there is no body buffering to break long-lived event streams.

## Register a mod

The routing table is the `UPSTREAMS` dict in `router/server.py` — registering a mod is one line:

```python
UPSTREAMS = {
    "desktop": "http://127.0.0.1:9000",
    "shell":   "http://127.0.0.1:9001",
}
```

1. Start the mod on its own loopback port (e.g. shell-sandbox publishes `127.0.0.1:9001`).
2. Add `"<name>": "http://127.0.0.1:<port>"` to `UPSTREAMS`.
3. Restart the router. The external tunnel port stays one (`8080`).

## Endpoints

The router splits the path as `<mod>/<rest>` and forwards to `UPSTREAMS[<mod>]/<rest>`:

| Agent hits (remote view) | Forwards to |
|---|---|
| `http://localhost:8080/desktop/mcp` | `http://127.0.0.1:9000/mcp` |
| `http://localhost:8080/shell/mcp` | `http://127.0.0.1:9001/mcp` |

An unregistered prefix returns **404**; a registered-but-unreachable mod returns **502**.

## Expose to the remote agent

```bash
ssh -R 8080:localhost:8080 <remote-host>      # all mods, one tunnel
```

## Test

```bash
cd Mods/router && uv run pytest
```
