# browser-cdp

**Not an MCP mod — it exposes no tools.** It is the CDP bridge that lets the remote agent's *own* Playwright MCP drive your local Mac browser: your logged-in sessions and cookies, visible on your screen.

The agent already ships Playwright MCP, so the browser tools exist on its side. Adding a second Playwright MCP here would only duplicate those tools. What is missing is the *browser to drive* — that is what this provides, by exposing a Chrome DevTools Protocol (CDP) endpoint the agent's Playwright connects to.

## Setup

```bash
# 1. Launch the local Chrome with a CDP endpoint (127.0.0.1:9222).
#    Uses a dedicated persistent profile — log into your sites once, it persists.
./launch-chrome-cdp.sh

# 2. Tunnel the CDP port to the remote agent host (this is separate from the
#    router's 8080 — CDP is not MCP, so it does not go through the router).
ssh -R 9222:localhost:9222 <remote-host>

# 3. Point the agent's existing Playwright MCP at it instead of launching its own
#    browser (or set "cdpEndpoint" in the agent's mcp.json).
npx @playwright/mcp@latest --cdp-endpoint http://localhost:9222
```

The agent now drives the Mac browser through its normal Playwright tools.

## Attach the backend agent

The attachment is **configuration, not a chat message** — the agent's Playwright MCP binds to the CDP endpoint when it *starts*, so set the endpoint in its `mcp.json` (on the agent side) and restart it:

```jsonc
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
    }
  }
}
```

If the agent's Playwright MCP is already running against its own browser, it must be **restarted** with this flag — a running server can't be re-pointed by chatting at it.

Once it's attached, you don't say anything special: the agent's normal browser tools (`browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`, …) now act on the Mac browser. Just give it the task — e.g. *"open github.com in the browser."*

To confirm the attach worked, ask for something only your Mac session would show:

> "Open github.com with the browser and tell me from a snapshot whether I'm logged in."

Seeing **your** logged-in account means it is driving the Mac browser (this profile). A blank, logged-out browser means it is still on its own browser — the `--cdp-endpoint` flag isn't applied (restart needed) or you haven't logged into the dedicated profile yet.

## Config

The launcher reads (all optional):

| Env | Default | Meaning |
|---|---|---|
| `CDP_PORT` | `9222` | CDP / remote-debugging port (loopback only) |
| `CDP_PROFILE` | `~/.yui-cdp-chrome` | Dedicated Chrome profile dir; persists logins across runs |
| `CHROME_BIN` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | Chrome executable |

## Safety boundary (operator responsibility)

- **A CDP endpoint is full, unauthenticated control of that browser.** Keep it on `127.0.0.1` and reach it only through the SSH reverse tunnel — never bind `0.0.0.0`.
- The dedicated `--user-data-dir` keeps this separate from your everyday Chrome profile; log into only what the agent needs.
- Modern Chrome refuses `--remote-debugging-port` on the default profile — this is why a dedicated profile dir is required, not optional.
