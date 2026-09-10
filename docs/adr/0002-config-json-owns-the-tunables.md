# Config JSON owns the tunables

`configs/*.json` is the single source of every tunable the validators read: the peek, walk, perch-walk,
fall, descend, climb, jump, tap, gesture-cue, drag-hold, framing, hit-test and gaze sections of
`avatar.json`, and the attachment caps of `guardrails.json`. The validator requires each of these
sections, and a missing key fails validation naming the key, the way `debounce_ms` in `guardrails.json`
does. The module that consumes a section reads the validated value. `available`, `tap.region_emotions`
and `tap.region_cues` are optional sections.

## Considered options

**Code owns the tunables.** Keep the `*_DEFAULTS` constants in `src/config/load.ts` and the literals in
`src/renderer/index.ts`, `src/io/hit-test.ts` and `src/renderer/cursor-gaze.ts`; delete the 88 duplicated
lines from `avatar.json` and the 4 from `guardrails.json`; leave the sections optional. Rejected: the
optional sections remain a configuration surface that no settings UI or store writes (measured with
`grep -rn` over `src/ui` and `src/io` for every key name), and `tap.region_emotions` / `tap.region_cues`
have no code default, so the JSON would carry two sections and the code eleven.

**Both copies, kept equal by hand.** Rejected: two copies of one value drift. `gaze.sensitivity` sat in
the JSON while `src/renderer/cursor-gaze.ts` read its own copy of the same value.

## Consequences

1. `configs/avatar.json` and `configs/guardrails.json` ship complete. A partial file fails at boot with
   the missing key named.
2. Every tunable has one home. `src/config/load.ts` defines the types and validators; the value lives in
   the JSON.
3. `motions.json`, `emotion_registry.json`, `filler.json` and `hotkeys.json` already work this way.
