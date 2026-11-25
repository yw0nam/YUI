# Wire Claude Code

Claude Code posts Threads through the plugin's hooks. You answer at the terminal. A Stop or a
session end posts `completed`; a permission request posts `input-required` and the hook returns
at once. No launch flag is needed, on a personal or a company account.

## 1. Check the hooks

Run `/reload-plugins` when the plugin was installed in this session.

Done when: `/hooks` lists the yui-notify `SessionStart`, `UserPromptSubmit`, `Stop`,
`SessionEnd`, `PermissionRequest`, `Notification`, `PostToolUse`, and `PostToolUseFailure` hooks.

## 2. Restart and prove a Thread

Give the user these checks for the new session, then end this one:

1. Start Claude Code as usual.
2. Send any prompt. When Claude stops, the session's Thread in YUI shows `completed`.
3. Trigger a permission prompt, such as a shell command that needs approval. The Thread waits
   as `input-required`.
4. Allow it at the terminal. Once the tool runs, the Thread turns `working`.

Done when: the user confirms the Thread shows `completed` at the stop and `working` after the
allowed tool ran. When a Thread never shows, read `references/troubleshooting.md`.
