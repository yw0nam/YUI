# Wire Claude Code

Claude Code posts Threads through the plugin's hooks. A session launched with the channel
flag takes answers through the channel server: Stop instructions and permission answers,
with the terminal free. Any other session, including one on an account where channels are
blocked, takes Stop instructions through the Stop hook, which holds the turn while it waits;
Esc at the terminal ends the wait. The Claude Code behaviour below follows the
[Channels docs](https://code.claude.com/docs/en/channels).

## 1. Install uv

The channel server runs on Python 3.11+ through `uv`. Hooks run on the system `python3`
(3.9+, standard library only). Install `uv` on every host that runs Claude Code,
SSH hosts included.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Done when: `uv --version` prints a version on every such host.

## 2. Check channel access

Channels are a Claude Code research preview. A Pro or Max account without an organization
has them. On a claude.ai Team or Enterprise plan, an Owner turns them on under
**Organization settings → Claude Code → Channels**, or sets `channelsEnabled: true` in
managed settings.

The startup banner names the account's plan, for example `Claude Max` or `Claude Team`. A
launch with the flag on an account without channels shows `blocked by org policy` under the
banner.

Done when: the user knows whether the account on this host has channels. Without them, skip
step 4 and start Claude Code without the flag in step 5.

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

On an account where channels are blocked, start Claude Code without the flag. With it, the
channel server still reports ready, so the Stop hook does not wait while Claude Code drops
the channel's messages, and the answer is lost.

Done when: the user has the alias in their shell startup file, or has chosen to type the
flag.

## 5. Restart and prove an answer

Give the user these checks for the new session, then end this one:

1. Start Claude Code, with the flag when the account has channels. At the
   development-channels warning, choose **I am using this for local development**, on a
   remote host too. The startup notice names `plugin:yui-notify@yui` as a channel.
2. Send any prompt. When Claude stops, the session's Thread in YUI asks “What next?”.
3. Type a short instruction in the Threads window and send it.

Done when: the user confirms Claude acted on the instruction: as a channel message with the
flag, or after “Stop hook error: <instruction>” without it. With the flag, an instruction
that arrives only after Claude Code shows “running Stop hook” means the channel is not
ready: read `references/troubleshooting.md` § Claude Code channel.
