# Config JSON owns the tunables

`configs/*.json` is the single home of every tunable the validators read. A tunable is a numeric or
enum knob the client reads at boot. The module that consumes a section reads the validated value.

The required sections are:

- `avatar.json`: `peek`, `walk`, `perch_walk`, `fall`, `descend`, `climb`, `jump`, `tap`,
  `gesture_cues`, `drag_hold_ms`, `framing`, `hit_test`, `gaze`.
- `guardrails.json`: `attachments`.

A missing section or key fails validation, and the error names the key, the way `debounce_ms` in
`guardrails.json` already does. Three sections stay optional: `available`, `tap.region_emotions` and
`tap.region_cues`.

## Considered options

**Code owns the tunables.** Keep the `*_DEFAULTS` constants in `src/config/load.ts` and the literals
in `src/renderer/index.ts`, `src/io/hit-test.ts` and `src/renderer/cursor-gaze.ts`. Delete the 88
duplicated lines from `avatar.json` and the 4 from `guardrails.json`. Leave the sections optional.

Rejected for two reasons. The optional sections stay a configuration surface that nothing writes: a
`grep -rn` over `src/ui` and `src/io` for every key name found no settings UI or store touching them.
And `tap.region_emotions` and `tap.region_cues` have no code default, so the JSON would carry two
sections while the code carried eleven.

**Both copies, kept equal by hand.** Rejected: two copies of one value drift. `gaze.sensitivity` sat
in the JSON while `src/renderer/cursor-gaze.ts` read its own copy of the same value.

## Consequences

1. `configs/avatar.json` and `configs/guardrails.json` ship complete. A partial file fails at boot
   with the missing key named.
2. Every tunable has one home. `src/config/load.ts` defines the types and validators; the value lives
   in the JSON.
3. `motions.json`, `emotion_registry.json`, `filler.json` and `hotkeys.json` already work this way.
