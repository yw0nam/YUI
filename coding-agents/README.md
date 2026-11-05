# Coding agents

Claude Code and Codex install these plugins from the `yui` marketplace in this repository. YUI itself never runs them.

| Plugin | What it does |
| --- | --- |
| [yui-notify](yui-notify/README.md) | Claude Code and Codex conversations arrive in YUI as Threads you read and answer. |
| yui-dev | Skills for a coding agent: [`yui-plugin`](yui-dev/skills/yui-plugin/SKILL.md) builds a YUI plugin and contributes it, and [`yui-wake-character`](yui-dev/skills/yui-wake-character/SKILL.md) wakes one character from a producer. |

## Install

Claude Code:

```text
/plugin marketplace add yw0nam/YUI
/plugin install yui-notify@yui
/plugin install yui-dev@yui
```

Codex:

```bash
codex plugin marketplace add yw0nam/YUI
codex plugin add yui-notify@yui
codex plugin add yui-dev@yui
```

A coding agent can also read a `yui-dev` skill by its raw URL without installing it, as [Write a plugin](../docs/guide/write-a-plugin.md) does.

## Read your coding agent's Threads

The [yui-notify](yui-notify/README.md) plugin posts Claude Code and Codex conversations as Threads. A Thread does not make a character speak. You answer them in YUI's Threads window.

Codex takes answers through synchronous hooks. Claude Code takes them through its own inbox socket, with no launch flag.

Turn on **External signals** in **Settings → Proactive → Watchers**, then restart YUI.
