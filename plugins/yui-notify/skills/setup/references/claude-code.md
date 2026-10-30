# Wire Claude Code

Claude Code posts Threads through the plugin's hooks and takes answers through its channel
server. The server delivers answers only in a session launched with the channel flag. A
plain `claude` launch posts read-only Threads.

## 1. Install uv

The channel server runs on Python 3.11+ through `uv`. Hooks run on the system `python3`
(3.9+, standard library only). Install `uv` on every host that runs Claude Code,
SSH hosts included.

Done when: `uv --version` prints a version on every such host.

## 2. Check channel access

Channels are a Claude Code research preview. A Pro or Max account without an organization
has them. On a claude.ai Team or Enterprise plan, an Owner turns them on under
**Organization settings → Claude Code → Channels**, or sets `channelsEnabled: true` in
managed settings.

Done when: the user confirms the account is Pro or Max, or that the organization has
channels on.

## 3. Check the hooks

Run `/reload-plugins` when the plugin was installed in this session.

Done when: `/hooks` lists the yui-notify `SessionStart`, `UserPromptSubmit`, `Stop`,
`SessionEnd`, `PermissionRequest`, and `Notification` hooks.

## 4. Save the launch command

The channel is a plugin outside Claude Code's channel allowlist, so it loads through the
development flag:

```bash
claude --dangerously-load-development-channels plugin:yui-notify@yui
```

Offer a shell alias so every later session keeps the flag:

```bash
alias claude-yui='claude --dangerously-load-development-channels plugin:yui-notify@yui'
```

Done when: the user has the alias in their shell startup file, or has chosen to type the
flag.

## 5. Restart and prove an answer

Give the user these checks for the new session, then end this one:

1. Start Claude Code with the flag. At the development-channels warning, choose
   **I am using this for local development**. The startup notice lists
   `plugin:yui-notify@yui` under Channels.
2. Send any prompt. When Claude stops, the session's Thread in YUI asks “What next?”.
3. Type a short instruction in the Threads window and send it.

Done when: the user confirms the instruction arrived in the session as a channel message
and Claude acted on it. A Thread that shows the reply but no “What next?” ask means the
channel is not ready: read `references/troubleshooting.md` § Claude Code channel.
