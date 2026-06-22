# router

One HTTP front door that path-routes to every mod, so a single SSH reverse tunnel exposes them all instead of one port per mod. Each mod stays an independent process on its own port — the router only forwards bytes by URL prefix, so the upstream mod can be written in any language:

```
http://host:8080/<mod>/mcp  ->  127.0.0.1:<mod port>/mcp
```

## Run

```bash
cd Mods/router && uv run mods-router --host 127.0.0.1 --port 8080
```

Runs host-native as a thin proxy. Routing table is the `UPSTREAMS` dict in `router/server.py` — adding a mod is one line; the external port stays one. Currently registered: `desktop` → `127.0.0.1:9000`, `shell` → `127.0.0.1:9001`. The agent then adds each tool source at `http://localhost:8080/<mod>/mcp` (e.g. `/desktop/mcp`, `/shell/mcp`) from the remote's view. An unknown mod prefix returns 404; an unreachable mod returns 502.

MCP's Streamable HTTP transport is SSE, so the router streams responses through unbuffered — there is no body buffering to break long-lived event streams.

## Expose to the remote agent

```bash
ssh -R 8080:localhost:8080 <remote-host>      # all mods, one tunnel
```

## Test

```bash
cd Mods/router && uv run pytest
```
