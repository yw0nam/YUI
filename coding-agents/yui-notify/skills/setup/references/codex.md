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
`PermissionRequest`, and `SessionEnd` hooks with no review warning. Codex runs no
`PostToolUse` or `PostToolUseFailure` hook, so a permission Thread stays `input-required`
until its next `Stop` or `UserPromptSubmit`.

## 4. Prove a Thread

Give the user these checks for the restarted session:

1. Send any prompt. When Codex stops, the session's Thread in YUI shows `completed`.
2. Trigger a permission prompt, such as a command that needs approval. The Thread shows
   `input-required`. Allow or deny it at the terminal.

Done when: the user confirms the Thread shows `completed` at the stop, and a permission
Thread stays `input-required` until the next stop or prompt.

## What Codex does not send

Codex has no `Notification` event, so an MCP elicitation prompt in Codex posts no
Thread. The `Stop`, `PermissionRequest`, and `SessionEnd` hooks cover the other three
moments.

## Hook timeouts

Codex gives `SessionEnd` one second by default and clamps a configured timeout to three
seconds. The plugin asks for three seconds, the most Codex allows. Claude Code gives
plugin `SessionEnd` hooks 1.5 seconds and does not raise that budget.
