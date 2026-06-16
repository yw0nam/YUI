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
     priority above idle and below reactive emotes (exact value taken from neighbouring
     entries when implementing).
   - Missing-file fallback: `loadClip` returning `null` already falls back to idle; confirm
     and test the fallback path.
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

- Loaded via `src/config/load.ts` (`validateFiller` + `CONFIG_FILES` + `AppConfig`), with
  fail-loud validation and hot-reload via the config store (same as other configs).

### Settings store: `src/io/filler-settings.ts`

- Shape: `{ enabled: boolean, language: "ja" | "en" | "ko", customPools: Partial<Record<lang, string[]>> }`.
- localStorage key `yui.filler`, following the `vad-settings.ts` store pattern
  (`get` / setters / `reloadFromStorage` / `subscribe` / `dispose`, storage adapter,
  stored > initial > defaults).
- **Effective pool** for a language = `customPools[lang]` if present and non-empty, else
  `config.filler.pools[lang]`. `threshold_ms` always comes from config.

### Dispatcher: `src/dispatcher/backend-caller.ts`

- New deps (all optional, injected from `main.ts`):
  - `onThinkingStart?: () => void`
  - `onThinkingEnd?: () => void`
  - `getFiller?: () => { enabled: boolean; thresholdMs: number; pool: string[] } | null`
  - a settable timer (default `setTimeout`/`clearTimeout`) so tests can drive it.
- On `call()` entry (after `onSpeechInterrupt`): if filler enabled, arm a `thresholdMs`
  timer.
- If the timer fires before the first stream event → `onThinkingStart()` (once).
- On the first `speech_delta` / `express` / `completed` / error / abort: clear the timer; if
  thinking had started, `onThinkingEnd()` (once). Fast responses (first event before
  threshold) never start thinking — no motion, no filler.

### Wiring: `src/main.ts`

- `onThinkingStart`:
  1. `renderer.playMotion({ id: "thinking", loop: true })`.
  2. Pick a random phrase from the effective pool; show it in the speech bubble and
     `ttsPipeline.submit(phrase)`.
- TTS ordering: filler is submitted first; real `speech_delta` text is submitted after, so
  the queue plays **filler → response** with no clipping. The real response replaces the
  filler text in the bubble when it begins streaming.
- `onThinkingEnd`: the response motion (from the backend cue) or idle baseline replaces the
  thinking motion through the normal motion controller; no special teardown beyond letting
  the queued filler finish.

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
- `src/dispatcher/backend-caller.test.ts` — timer fires `onThinkingStart` only when slow;
  not when the first event beats the threshold; `onThinkingEnd` on first delta / error /
  abort; filler disabled → no timer.
- motion registry/renderer test — `thinking` entry valid; missing-file → idle fallback.
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
