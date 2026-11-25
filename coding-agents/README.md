# Coding agents

Claude Code and Codex install these plugins from the `yui` marketplace in this repository. YUI itself never runs them.

| Plugin | What it does |
| --- | --- |
| [yui-notify](yui-notify/README.md) | Claude Code and Codex conversations arrive in YUI as view-only Threads you read; you answer at the agent's terminal. |
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

The [yui-notify](yui-notify/README.md) plugin posts Claude Code and Codex conversations as Threads. A Thread does not make a character speak, and Threads are view-only: you answer the agent at its own terminal.

Running your agents inside herdr? Use YUI's [herdr plugin](../plugins/herdr/README.md) instead and leave yui-notify uninstalled: both would report the same session.

Turn on **External signals** in **Settings → Proactive → What she reacts to → External signals**, then restart YUI.
