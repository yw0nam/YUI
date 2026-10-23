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

Done when: `/hooks` lists the yui-notify `Stop` and `PermissionRequest` hooks with no
review warning.

## What Codex does not send

Codex has no `Notification` event, so an MCP elicitation prompt in Codex posts no
`agent.needs_input` signal. The `Stop` and `PermissionRequest` hooks cover the other two
moments.
