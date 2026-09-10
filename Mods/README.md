# YUI Mods

Standalone MCP servers ("Mods") that expose host capabilities to the remote backend agent (Hermes). Each Mod is an independent process, decoupled from the YUI app — the agent attaches them as tool sources alongside the Expression Broker.

Each mod is a self-contained `uv` project in its own folder (`Mods/<mod>/`), with its own `pyproject.toml` and `uv.lock`. See the [Mods reference](../docs/reference/mods.md) for the project convention, the port and capability catalog, and each mod's tool list.

## Mods

[router](router/), [desktop-control](desktop-control/), [shell-sandbox](shell-sandbox/), and [avatar](avatar/) — see the [Mods reference](../docs/reference/mods.md) for what each one does and its port. [browser-cdp](browser-cdp/) is not a mod, and exposes no MCP tools — it bridges the remote agent's own Playwright MCP to your local Mac browser over CDP (use it instead of adding a redundant browser mod). Each mod's own README covers its run, safety boundary, tools, and tests.

## Exposure

Every mod binds `127.0.0.1` only; reach it from the remote agent over an SSH reverse tunnel. The [router](router/) collapses all mods onto one tunnel (`8080`) so you don't forward a port per mod.
