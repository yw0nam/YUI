# Wire Codex

Codex installs the plugin from the repository's marketplace and reads the same
`hooks/hooks.json` as Claude Code.

## 1. Install the plugin

```bash
codex plugin marketplace add yw0nam/YUI
codex plugin add yui-notify@yui
```

Done when: `codex plugin list` names `yui-notify`.

## 2. Restart Codex

Start a new Codex session so it loads the plugin and its hooks.

Done when: the session starts.

## 3. Trust the hooks

At startup Codex shows "Hooks need review". Choose "Trust all and continue", or open
`/hooks` and trust each yui-notify hook there.

The trust record belongs to one version of the plugin bundle. After a plugin update the
hooks show "Modified since last trusted - review required", and Codex blocks them until
the user trusts them again.

Done when: `/hooks` lists the yui-notify `SessionStart`, `UserPromptSubmit`, `Stop`,
`PermissionRequest`, and `SessionEnd` hooks with no review warning.

## 4. Prove an answer

Give the user these checks for the restarted session:

1. Send any prompt. When Codex stops, the session's Thread in YUI asks “What next?”.
2. Type a short instruction in the Threads window and send it.

Done when: the user confirms Codex continued the turn with that instruction.

## What Codex does not send

Codex has no `Notification` event, so an MCP elicitation prompt in Codex posts no
Thread. The `Stop`, `PermissionRequest`, and `SessionEnd` hooks cover the other three
moments.

Codex reads a plugin's `.mcp.json` command literally, so the plugin manifest declares
no MCP server and Codex starts none. The channel server belongs to Claude Code.

## Hook timeouts

Codex gives `SessionEnd` one second by default and clamps a configured timeout to three
seconds. The plugin asks for three seconds, the most Codex allows. Claude Code gives
plugin `SessionEnd` hooks 1.5 seconds and does not raise that budget.
