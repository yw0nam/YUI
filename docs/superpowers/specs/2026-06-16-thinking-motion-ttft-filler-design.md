# Thinking Motion + TTFT Filler — Design

## Goal

While a backend request is in flight and the first token has not yet arrived (TTFT),
the client plays a looping "thinking" motion and, when the wait is long enough, speaks a
short filler line ("うーん…") through the speech bubble + TTS. The thinking motion is
registered in the motion set. Filler behaviour (enable, language, custom phrases) is
configurable from the settings UI.

## Core principle alignment

`firing ≠ judgment`. The thinking state is a **client latency affordance**, not a backend
judgment: the backend cannot help during TTFT because TTFT *is* the wait for the backend.
The filler line is therefore client-originated. To stay within "no brain in the client" and
"no hardcoding", filler phrases live in `configs/` (a fixed, documented backchannel pool),
never inline in code, and the thinking motion is **not** published to the broker
(`broker_publish: false`) — the backend never selects it.

## Foundation (already landed on main)

- Purchased motions relocated `resources/purchased_motions/` → `public/purchased_motions/`
  so they are served by vite `publicDir` (dev) and copied into `dist` (Tauri) with zero
  wiring. `loadClip` loads `vrma_path` directly (no `resolveAssetUrl`), so a
  `/purchased_motions/…` path resolves in both environments.
- `thinking.vrma` (converted from `thinking.anim` via Mate-Engine `unity-cli`) present at
  `public/purchased_motions/thinking.vrma`; gitignored + write/bash-guard protected.
- Verified: vite serves `GET /purchased_motions/thinking.vrma` → 200, valid glTF +
  `VRMC_vrm_animation`.

## Part B — register motion + worktree asset linking

1. `configs/motions.json`: add `thinking`:
   - `vrma_path: "/purchased_motions/thinking.vrma"`, `kind: "state"`, `loop: true`,
     `interrupt_policy: "replace"`, `fade_ms: 200`, `broker_publish: false`,
     `priority: 50` — above `idle` (0), below the perch held-state `window_sit` (55) so it
     never disrupts a held state, and below reactive emotes (70) so the backend's response
     motion replaces it.
   - Missing-file behaviour: `loadClip` returning `null` does **not** auto-return to idle —
     `startMotion` silently no-ops (`src/renderer/index.ts:681`), leaving the character on
     its current baseline (idle in the common case). This is acceptable: a missing
     `thinking.vrma` simply means no thinking pose, while the filler line still plays. The
     spec does **not** rely on an idle fallback; tests assert the silent no-op, not a fallback
     motion.
2. `scripts/worktree-setup.sh`: link `public/purchased_motions` from the main checkout so
   gitignored purchased motions exist in worktrees (mirrors the `resources/references` link).
3. `docs/motions.md`: document the `thinking` entry (current-state, declarative).

## Part C — TTFT thinking behaviour

### Config: `configs/filler.json`

```jsonc
{
  "threshold_ms": 500,                 // fire only if first token hasn't arrived by now
  "pools": {                           // default backchannel phrases per language
    "ja": ["うーん…", "そうだね…", "ええと…", "ちょっと待ってね…"],
    "en": ["Let me think...", "Hmm...", "Well..."],
    "ko": ["음…", "글쎄…", "잠깐…"]
  }
}
```

- `FillerConfig` and `type FillerLang = "ja" | "en" | "ko"` are declared in
  `src/config/load.ts` (alongside `AvatarConfig`/`GuardrailsConfig`), **not** in
  `src/contract/types.ts` — filler never crosses the Hermes wire, so it must not pollute the
  wire contract. `filler-settings.ts` imports `FillerLang` from `load.ts`.
- Wiring into the loader is created from scratch (none exists yet): add `filler` to
  `AppConfig`, add the `filler` key to `CONFIG_FILES`, add `validateFiller`, and extend
  `loadConfig`'s `Promise.all`/return. Hot-reload via the config store then covers `filler`
  automatically (it becomes a `ConfigSection`).
- `validateFiller` is fail-loud, matching `validateMotions`: `threshold_ms` is a positive
  integer in `[100, 10000]`; `pools` keys are restricted to the closed `FillerLang` union
  (unknown keys rejected); each pool value is a **non-empty** `string[]` of non-empty
  strings.

### Settings store: `src/io/filler-settings.ts`

- Shape: `{ enabled: boolean, language: FillerLang, customPools: Partial<Record<FillerLang, string[]>> }`
  (`FillerLang` imported from `load.ts`).
- localStorage key `yui.filler`, following the `vad-settings.ts` store pattern
  (`get` / setters / `reloadFromStorage` / `subscribe` / `dispose`, storage adapter,
  stored > initial > defaults).
- **Effective pool** for a language = `customPools[lang]` if present and non-empty, else
  `config.filler.pools[lang]`. `threshold_ms` always comes from config.
- The dispatcher's `getFiller` and `main.ts`'s `onThinkingStart` read the **current**
  config-store and settings-store snapshots at call time (live getters, not values captured
  at wiring time) so a hot-reload or settings change takes effect on the next turn.

### Dispatcher: `src/dispatcher/backend-caller.ts`

- New deps (all optional, injected from `main.ts`):
  - `onThinkingStart?: () => void`
  - `onThinkingEnd?: () => void`
  - `getFiller?: () => { thresholdMs: number } | null` — returns `null` when filler is
    disabled or the effective pool is empty, so the dispatcher arms the timer only when a
    filler will actually be shown. (The phrase/pool resolution lives in `main.ts`'s
    `onThinkingStart`; the dispatcher only owns timing.)
  - settable `setTimeout` / `clearTimeout` (defaulting to the globals) so tests drive the
    threshold deterministically — the existing harness uses dependency injection, not
    `vi.useFakeTimers()`, and the `streamChat` mock yields synchronously.
- **Per-`call()` locals** (never closure/module scope — `call()` invocations can overlap
  when one turn aborts and the next starts): `let handle`, `let thinkingStarted = false`,
  `let thinkingDone = false`, plus two idempotent wrappers:
  - `startThinking()`: `if (thinkingStarted || thinkingDone) return; thinkingStarted = true; onThinkingStart?.()`
  - `endThinking()`: `if (thinkingDone) return; thinkingDone = true; clearTimeout(handle); if (thinkingStarted) onThinkingEnd?.()`
- Arm the timer after `onSpeechInterrupt` (`:261`), only if `getFiller()` is non-null, with
  `handle = setTimeout(startThinking, thresholdMs)`.
- **Clear on the first stream event of *any* type**: `endThinking()` runs as the first
  statement inside the `for await` loop body, *before* the `switch` — because `usage`,
  `tool_status`, or `speech_done` can be the first event ahead of `speech_delta`
  (`ChatStreamEvent` has seven members; enumerating a subset is a bug).
- **Wrap the whole post-arm body (`:264`–`:419`) in `try { … } finally { endThinking() }`**
  so every early return clears the timer / ends thinking. Without this, the setup-stage
  reject (`:273`), the early-abort return (`:278`), and the empty/`parse_error` return
  (`:361`) leak a started-but-never-ended thinking state.
- "Fire once / end once" is guaranteed by the flags above, not by `clearTimeout` alone (an
  already-queued timer callback still runs after the first event without the
  `thinkingStarted/thinkingDone` gate). Fast responses (first event before threshold) never
  start thinking — no motion, no filler.

### Wiring: `src/main.ts`

- `onThinkingStart`:
  1. `renderer.playMotion({ id: "thinking", loop: true })`.
  2. Resolve the effective pool here (`fillerSettings.customPools[lang]` if non-empty, else
     `config.filler.pools[lang]`), pick a random phrase, and play it as one complete
     utterance via `speechPlayback.onSpeech(phrase)` — the public path that feeds the TTS
     pipeline (there is **no** public `ttsPipeline.submit`; `onSpeech` runs delta+end). The
     filler carries **no cue** (`setCue`/`onCue` timing stays anchored to the response
     deltas only).
- TTS ordering: the pipeline plays in FIFO submission order, but the **filler→response order
  is guaranteed by the dispatcher start-gate** — once the first stream event arrives,
  `thinkingStarted` is gated so the filler can never be submitted late. The real response's
  `speech_delta` flow then begins a fresh speech segment (existing `beginSpeech`/`pushSpeech`
  via `speech-playback`), and the queued filler audio finishes ahead of it.
- `onThinkingEnd`: release the thinking motion to the normal controller — the response cue
  motion (priority 70) or idle baseline replaces it via `interrupt_policy`. Do **not** issue
  an explicit motion stop here: an explicit stop could cancel the *next* turn's just-started
  thinking motion when turns overlap. No bubble teardown beyond the existing per-turn
  `onSpeechInterrupt`.

## Part D — settings UI

Per AGENTS.md UI flow: review existing surfaces → propose structure → **mock HTML** → implement.

- `src/ui/quick-controls.ts` "대화" (Talk) tab gains a filler section:
  - enable toggle (`.yui-switch` pattern),
  - language segmented control (`.yui-seg` pattern: ja / en / ko),
  - per-language phrase editor (textarea, newline-separated) writing `customPools[lang]`.
- Bind to `fillerSettings` store; register it in `wireStorageSync` + the settings-window
  broadcast so the pet window picks up changes live.
- Style with existing `tokens.css` / `quick-controls.css`; mock HTML authored first.

## Testing (TDD, failing test first per area)

- `src/io/filler-settings.test.ts` — store priority/persistence/idempotence/sync/dispose.
- `src/config/load.test.ts` — `validateFiller` accept/reject cases.
- `src/dispatcher/backend-caller.test.ts` (DI fakes for `setTimeout`/`clearTimeout`,
  `onThinkingStart`/`onThinkingEnd` as `vi.fn()`):
  - slow turn → `onThinkingStart` once, then `onThinkingEnd` once;
  - fast turn (first event before threshold) → neither fires;
  - first event is `usage` (not `speech_delta`) → timer cleared, thinking never starts;
  - leak paths: setup-stage reject (`:273`) and empty/`parse_error` response (`:361`) with the
    timer already fired → `onThinkingEnd` exactly once;
  - external-signal abort mid-thinking → `onThinkingEnd` once;
  - `getFiller()` returns `null` (disabled/empty pool) → timer never armed.
- motion registry/renderer test — `thinking` entry valid; missing clip → `startMotion` silent
  no-op (no fallback motion, no throw).
- `src/ui/quick-controls.test.ts` — filler controls bind to the store.
- `tests/hooks/guards.test.ts` — already covers `public/purchased_motions` (landed).

## Out of scope

- No backend/contract change (`generate_express` is untouched; thinking is client-only).
- No new logical asset prefix wiring in vite/tauri (public serving reused).

## Verification

- `pnpm test`, `pnpm lint`, `pnpm build`, `cargo test` green.
- Runtime (Reality Checker): link `thinking.vrma` into the worktree, run the app, confirm the
  thinking motion loops during a slow turn and the filler line shows + speaks, then the real
  response follows.
