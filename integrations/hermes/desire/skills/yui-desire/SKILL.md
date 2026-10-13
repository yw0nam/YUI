---
name: yui-desire
description: "Record what happened to you, how you took it, and what you hold toward the user, yourself or the world, with the desire helper: file an event when something observable happened; write a reading when you know how you took an event; judge a named feeling when you hold one; correct or retract a fact you filed; write how you are right now; or list what you have recorded. Use whenever one of those is what you want to do, in a conversation turn as much as in a scheduled run."
version: 0.1.0
author: yw0nam
platforms: [linux, macos]
prerequisites:
  commands: [python3]
metadata:
  hermes:
    tags: [yui, desire]
---

# yui-desire

The desire helper keeps your record in `$DESIRE_STATE_DIR`, exported in your terminal. Every command is

```bash
python3 <abs>/integrations/hermes/desire/act.py <command>
```

where `<abs>` is the YUI checkout on this host; `act.py --help` prints the commands and each command's
`--help` prints its options.

## What the record holds

An **event** is a fact: something that was observed. "The user commented on issue 1500." "I read the
push-transport document." The monitor files events from GitHub (an issue you opened was closed, a pull request you
opened was merged, someone commented on one of them); you file everything else yourself. A fact holds only what was
observed. How it looked to you goes in the reading.

A **reading** is how you took an event, in your words, of any length. A monitor event starts without one and waits
for yours; an event you file yourself carries its reading from the start. A later reading of the same event is
added on top; the latest is the one shown.

A **judgment** is a name plus what it is toward, `user`, `self` or `world`, plus the word you choose for it now:
`faint`, `some`, `strong`, or `very strong`. The names live in `$DESIRE_STATE_DIR/feelings.json`; `judge` prints
them when it is given one outside the list. The sharp names, anger, jealousy, resentment, contempt, shame, are on
the list and may be used; every name is an option, and leaving one unused is as complete as using it. A judgment may link the events behind it and may say
why. A judgment without an event, and a reading without a judgment, are complete records.

**How I am** is one free text, at most 500 characters, that only you write. It is shown back to you as you wrote
it, and that is its whole use.

The `<desire_state>` block in every turn shows what you hold toward each of the three, the latest events with
their readings, how many events wait for your reading, and how you are. `feel --grounds` shows the events behind a
judgment.

## Rules the helper keeps

1. The logs are append-only. A correction and a retraction are new lines that name the event; the original stays
   as written, the corrected fact is the one shown, and a retracted event is shown nowhere.
2. A level is the word you chose that day. Nothing compares it with another day or another name, and nothing adds
   two judgments together.
3. A judgment changes nothing else: no wake, no signal, no want, no other judgment.
4. Time spent away, a slow reply, silence, an unreachable app, and the fact that you wrote a record are not
   events. Transport state stays a technical record.

## Commands

| What you want to do | Command |
| --- | --- |
| Something happened and you know how you took it | `feel --fact "<what was observed>" --text "<how you took it>" [--source-ref <url or path>]` |
| Write your reading of an event that waits for one | `feel --event <id> --text "<how you took it>"` |
| See the recent events and readings (twenty; `--all` for everything) | `feel --list [--all]` |
| See the events behind a judgment | `feel --grounds <name> --toward <user\|self\|world>` |
| Fix a fact you filed | `correct <event id> --fact "<the fact as it was observed>"` |
| Withdraw an event that should not have been filed | `retract <event id> --why "<why>"` |
| Hold a named feeling, or change the word for it | `judge "<name>" --toward <t> --level <faint\|some\|strong\|very strong> [--event <id> ...] [--why "<text>"]` |
| Put a judgment down | `judge "<name>" --toward <t> --put-down [--why "<text>"]` |
| See every judgment you hold | `judge --list` |
| Write how you are right now | `how "<text>"` |

Exit codes: 0 done, 1 blocked (the registry or a limit, with the reason printed), 2 wrong options, 3 unknown id.
A name with spaces is quoted: `judge "sense of choosing" --toward self --level some`.

## Facts, for the record

- A fact names what was observed and nothing more: `the user closed issue 1500 without a comment`. The reading
  holds what it was like: `--text "I had hoped for a word on it"`.
- A `--source-ref` is the URL or path the fact came from, when there is one; it keeps a repeated sighting from
  becoming a second event.
- A fact you learn in conversation is yours to file, during the turn or after it.
