# Build a YUI plugin

This file takes a plugin from an idea to a plugin that runs in the user's own YUI. Follow the rules in [SKILL.md](https://raw.githubusercontent.com/yw0nam/YUI/main/skills/yui-plugin-build/SKILL.md).

## 1. Decide what the plugin does

Ask the user what the character should be able to do. Turn each capability into one tool name. Add a skill only when a workflow needs several steps in a row. Read [Layout](https://github.com/yw0nam/YUI/blob/main/docs/guide/write-a-plugin.md#layout) and [Tools and skills](https://github.com/yw0nam/YUI/blob/main/docs/guide/write-a-plugin.md#tools-and-skills) for the tool name rule and the built-in names.

Done: a list of tools, each with a one-line summary, and no name on that list is a built-in client tool name.

## 2. Make the folder

Create the folder with `.claude-plugin/plugin.json`, `.mcp.json`, the server, and `skills/` when step 1 asked for a skill. Write the server in any language that speaks MCP over stdio. Read [Layout](https://github.com/yw0nam/YUI/blob/main/docs/guide/write-a-plugin.md#layout) for the fields of `plugin.json` and [Servers](https://github.com/yw0nam/YUI/blob/main/docs/guide/write-a-plugin.md#servers) for `.mcp.json`.

Done: the files exist, and the `name` in `plugin.json` follows the id rule.

## 3. Prove the server outside YUI

Start the `command` from `.mcp.json` by hand. Send `initialize` and `tools/list` to its stdin. Read [Servers](https://github.com/yw0nam/YUI/blob/main/docs/guide/write-a-plugin.md#servers) for what YUI expects of each reply.

Done: both requests answer, and stdout carries MCP messages only.

## 4. Load it in YUI

Ask the user to open **Plugins**, choose **Add from folder…**, turn the plugin on, and press **Allow**. [Plugins § Add from a folder](https://github.com/yw0nam/YUI/blob/main/docs/guide/plugins.md#add-from-a-folder) holds that path. The user does the clicks.

Done: the user reports the status line Running with the tool count. When the status names a failure, read the plugin log ([Plugins § Log](https://github.com/yw0nam/YUI/blob/main/docs/guide/plugins.md#log)) and fix what it names.

## 5. Use it

Ask the user to ask the character for something that needs a tool from step 1.

Done: the user confirms the reply used the tool.

## 6. Hand back

Tell the user where the folder is and which edits need the plugin off and on ([Test locally](https://github.com/yw0nam/YUI/blob/main/docs/guide/write-a-plugin.md#test-locally)). Then give the sharing line at the end of this step.

Done: the user has the folder path, the restart rule, and this sentence: "To share this plugin with other users, ask me to contribute it."
