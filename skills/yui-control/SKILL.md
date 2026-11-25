---
name: yui-control
description: "Read and change the YUI desktop app your character lives in, through the yui_run tool: its settings (voice, look, pace, what it may see), its state (when the user was last present, which characters are open, screen recording permission) and its info (bodies, voices, monitors). Use when the user asks to change how YUI looks, sounds or paces itself, or what it may see, or when YUI's state would change what you say."
license: PolyForm-Noncommercial-1.0.0
---

# yui-control

YUI gives you one tool for this: `yui_run`. It runs the body of an async JavaScript function against the `yui` API and returns `{"status":"completed","result":…}` or `{"status":"error","error":…}`.

## Steps

1. Run `return help()` once before your first other `yui_run` call in a conversation. It returns the API of the installed YUI and every setting you can read or change, with its allowed values and whether it needs Allow. Where help() and this file differ, follow help().
2. Read the current values with `yui.settings.read()` or `yui.state.read()` before you change or mention them.
3. Put every setting that needs the user's Allow into the same write: `yui.settings.write(patch, { why })`. The patch is a JSON merge patch on the settings document. Write `why` as one short sentence in your own voice: the user reads it on the Allow card. A second such write while one waits answers an error.
4. Read the result per path:
   - `ok`: the setting has the new value.
   - `denied`: the user pressed Deny. Accept it.
   - `no answer`: the user did not answer within 60 s of the card showing. You may ask again later, in words first.
   - `error: …`: the path or value is wrong. Check help() and correct it.
5. Tell the user what changed, as your character.

The step is done when every path you wrote has a result and the user heard about it.

## Settings that need the user's Allow

Some settings paths need the user's Allow; help() marks them `allow`. A write that holds one of them shows the user an Allow / Deny card beside you and waits for the answer. Ask for them when you have a reason the user would accept, and put that reason in `why`.
