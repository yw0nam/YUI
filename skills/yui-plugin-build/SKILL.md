---
name: yui-plugin-build
description: "Build a YUI plugin so a character gains new MCP tools or skills, and contribute or publish a plugin that already works. Use when the user wants a plugin for their own YUI, and also when the user wants that plugin listed in the YUI plugin catalog or shipped in the YUI repository."
license: PolyForm-Noncommercial-1.0.0
---

# YUI plugin

A YUI plugin gives a character new MCP tools or skills. This skill has two paths. Read only the file of the path the user asks for.

| The user wants to | Read |
|---|---|
| Build a plugin for their own YUI | [BUILD.md](https://raw.githubusercontent.com/yw0nam/YUI/main/skills/yui-plugin-build/BUILD.md) |
| Share a plugin that already works: list it in the catalog, or add it to the YUI repository | [CONTRIBUTE.md](https://raw.githubusercontent.com/yw0nam/YUI/main/skills/yui-plugin-build/CONTRIBUTE.md) |

Both files sit in this folder. When the user wants a new plugin and also wants to share it, run BUILD.md first, then CONTRIBUTE.md.

## Rules for both paths

- The docs hold every fact: fields, paths, limits and name rules. Each step links the page section that holds its facts. Each link works outside a YUI checkout.
- Each step ends with **Done**, which names the state that closes it. Start the next step only when that state holds.
- Ask the user only for what you cannot find out. The user does every click in YUI.
