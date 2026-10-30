# Wire Claude Code

Claude Code posts Threads through the plugin's hooks and takes answers through its own
inbox socket. A Stop asks “What next?” and returns at once; a background poller waits for
the answer and posts it into the session, which starts the next turn. A permission request
waits for Allow, Deny, or text while the terminal dialog stays open beside it. No launch
flag is needed, on a personal or a company account.

## 1. Check the Claude Code version

The inbox socket needs Claude Code v2.1.224 or later. Without it, Stops post read-only
Threads.

Done when: `claude --version` prints 2.1.224 or later on every host that runs Claude Code.

## 2. Check the hooks

Run `/reload-plugins` when the plugin was installed in this session.

Done when: `/hooks` lists the yui-notify `SessionStart`, `UserPromptSubmit`, `Stop`,
`SessionEnd`, `PermissionRequest`, and `Notification` hooks, and `/status` shows a
`Peer address` row with a `uds:` path.

## 3. Restart and prove an answer

Give the user these checks for the new session, then end this one:

1. Start Claude Code as usual.
2. Send any prompt. When Claude stops, the session's Thread in YUI asks “What next?”.
3. Type a short instruction in the Threads window and send it.

Done when: the user confirms that the session showed `Another Claude session sent a
message:` with the instruction under “Reply from the user in YUI's Threads window:”, and
Claude acted on it. Claude Code labels every message that arrives on the inbox socket this
way. When nothing arrives, read `references/troubleshooting.md` § Claude Code inbox.
