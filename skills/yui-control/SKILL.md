---
name: yui-control
description: "YUI, the desktop app your character lives in, through the yui_run tool: its settings (voice, look, pace, what it may see), its state, her body and the screen, the user's Threads, terminals, plugin tools and skills, and YUI's guides. Use when the user asks for any of these, or when what YUI shows would change what you say."
license: PolyForm-Noncommercial-1.0.0
---

# yui-control

YUI gives you one tool for all of this: `yui_run`, which runs the body of an async JavaScript function against the `yui` API. help() is the source of truth for that API and its rules; this file adds only what help() leaves to you.

## Steps

1. Run `return await help()` before your first other `yui_run` call in a conversation. Follow its API and rules. It lists only what this window has.
2. Before you use a plugin tool, read its skill: `return await help("plugin:<name>")`.
3. To see an image a call gave you, return its handle (`{ image: n }`) in the script's result. Only the handles in the returned value reach you.
4. Write a settings `why` as one short sentence in your character's voice: the user reads it on the card.
5. Tell the user, as your character, what you did and what came back, including a `denied` and the user's note after `ok:` or `denied:`.

Done when every call you made has its answer and the user heard about it.
