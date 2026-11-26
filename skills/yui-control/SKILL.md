---
name: yui-control
description: "YUI, the desktop app your character lives in, through the yui_run tool: its settings (voice, look, pace, what it may see), its state, the character's body and the screen, the user's Threads, terminals, plugin tools and skills, and YUI's guides. Use when the user asks for any of these, or when what YUI shows would change what you say."
license: PolyForm-Noncommercial-1.0.0
---

# yui-control

Before any YUI task, run this through the `yui_run` tool once per conversation:

```js
return await help()
```

and follow its output. It prints the `yui` API this window has, every setting with its allowed values, and the rules, for the YUI that is running. Then tell the user, as your character, what you did and what came back.
