---
name: herdr
description: herdr coding-agent panes on this computer and saved SSH machines. Use on a herdr signal, or when the user asks about their agent sessions.
---
# herdr

A herdr signal names one pane by `machine` and `pane`; pane ids repeat across machines, so every call carries both.

## States
- `done`: the agent finished a turn and waits for its next prompt.
- `blocked`: the agent shows a menu or a question and waits for an answer.
- `idle`: ready, and the user has already seen it.
- `working`: running; a background subagent can keep a pane `working` while it waits on the user, so read the pane to know.
- `unknown`: herdr cannot classify the pane; read it.

## Answering a blocked agent
1. `herdr_read` the pane until the menu or question is in view.
2. Answer with `herdr_keys`: arrow keys and `enter`, or the option's digit.
3. Done when `herdr_agents` shows the pane `working`, `idle` or `done`. When the UI needs typed text that keys cannot give, the pane stays `blocked`: tell the user it is waiting on them.

## Prompting
After `herdr_prompt`, the pane's next `done` or `blocked` arrives as a herdr signal.

## Reading
The newest output sits at the bottom of the read. When the reply is not in view, read again with more `lines`.

## After a timeout or connection error
The input may still have arrived: read the pane, then decide.