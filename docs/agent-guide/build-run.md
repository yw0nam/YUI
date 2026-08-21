# YUI — Build, Run & Logs

## Build / Run

```bash
pnpm install
pnpm dev                    # Vite dev server (fixed port 1420) — browser only
pnpm tauri dev              # Tauri app (fixed port 1420, transparent pet window)
pnpm dev:auto               # Vite dev server, browser only — auto-picks a free port from 1420 up (or honors YUI_DEV_PORT)
pnpm tauri:dev              # Tauri app — auto-picks a free port from 1420 up (or honors YUI_DEV_PORT); enables concurrent worktrees
pnpm build                  # tsc + vite build
pnpm test                   # vitest run
pnpm test:watch             # vitest watch
pnpm lint                   # biome check (format + lint)
pnpm lint:fix               # biome check --write (apply safe fixes)
pnpm tauri build            # Native bundle
cd src-tauri && cargo check # Rust compile check
cd src-tauri && cargo test  # Rust unit tests
```

## Release

`bundle.targets` in `src-tauri/tauri.conf.json` is `["dmg", "msi", "nsis"]` — the installers that get shipped. The Tauri bundler intersects that list with what the host platform can build, so macOS produces the `.dmg` and Windows produces `.msi` + NSIS `-setup.exe`.

Releases are cut by the operator with `./scripts/release.sh <major|minor|patch>` on a clean, synced `main` (the script refuses to run for an agent). It bumps the version in `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `package.json` — all three must agree, since the script computes the next version from `Cargo.toml` and the workflow guards on the other two — then commits, tags `vX.Y.Z`, and pushes. From the tag:

1. The `Release` workflow (`.github/workflows/release.yml`) rejects the tag unless `X.Y.Z` matches the version in both files, then creates a **draft** GitHub release named after the tag, builds macOS `aarch64-apple-darwin` and Windows x64 in parallel and uploads every bundle to that draft. The release body labels the Windows artifacts experimental.
2. Review the draft on GitHub (generate the notes from the release page) and publish it manually. Nothing else creates a release for the tag — the workflow's draft is the only one, and CI never publishes.

A tag containing a hyphen (`v0.3.0-rc.1`) drafts as a prerelease; the suffix lives on the tag only, so the guard compares `0.3.0` against the app version. Re-running the workflow for the same tag reuses the existing draft instead of creating a second one.

### macOS signing

Signing and notarization are driven entirely by environment variables read by the Tauri CLI; the workflow exports them only when the corresponding repository secrets are non-empty:

| Secret | Effect |
| --- | --- |
| `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` | The CLI imports the base64 `.p12` into a temporary keychain and signs the bundle. Both are required together. |
| `APPLE_SIGNING_IDENTITY` | Optional. Cross-checks the identity of the imported certificate. |
| `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` | Notarizes and staples the signed `.app`. All three are required together. |

With none of them registered the workflow succeeds and ships an unsigned, un-notarized `.dmg`; users open it via Finder's right-click → **Open**. Registering the secrets turns signing on without touching the workflow.

`bundle.yml` is a separate smoke check: it bundles macOS on every push to `main` and uploads the `.dmg` as a workflow artifact. It never touches releases.

## Dev reload

Dev updates reload the whole page. No `import.meta.hot.accept()` boundary exists in `src/`, so Vite falls back to `location.reload()` on every change — partial HMR is not used. The `main.ts` disposer collection serves teardown correctness, not dev-session state preservation.

## Logs

Frontend (`src/logger.ts` → `[YUI][namespace] …`) and Rust (`log` crate) lines are written to per-day files `YUI_YYYY-MM-DD.log`, rotated at midnight in the `YUI_LOG_TZ` timezone and retained 14 days (older dated files are pruned on rotation). Dev (`pnpm tauri dev`): `<repo>/logs/` (gitignored) — tail with `tail -f logs/*.log`. Release (macOS): `~/Library/Logs/com.yui.desktop/`. Levels: dev `debug`, release `warn`; override frontend via `VITE_YUI_LOG_LEVEL` (`debug|info|warn|error`).

### Turn records

Alongside the app log, `turns_YYYY-MM-DD.jsonl` accumulates one JSON line per completed backend turn and one per fire skipped before becoming a turn — the long-horizon source for speak-rate/suppression measurement, readable with `jq` while the app runs. Same directory, rotation, and 14-day retention as the app log: dev `<repo>/logs/`, release `~/Library/Logs/com.yui.desktop/` (macOS). Written via the Rust `append_turn_record(line)` command; `src/io/turn-record-log.ts` builds each line and calls it fire-and-forget, so a failed write never breaks the turn or the fire path.

Two record shapes, distinguished by `type`:

- `{"type":"turn","ts","event_name","trigger_kind","client_context",spoke_text}` — one per completed turn, `ts` the moment the turn completed. `client_context` is the same object sent to the backend; `spoke_text` is `false` when the backend returned no/empty speech.
- `{"type":"skip","ts","source","reason",…}` — one per fire suppressed before it became a turn, `ts` the moment the suppressed candidate arose. `source` names the gate that refused it and decides the remaining field: `"screen"` records carry `transition` (`app_switched` / `long_session`) and a `reason` of `disabled` / `not_present` / `min_gap` / `quiet_after_turn` / `global_gap`; `"dispatcher"` records carry `event_name` and always the reason `global_gap` — the global proactive gap held that fire back.

The capped `yui.context-history` (localStorage, last 20 entries) stays the DevTools Context Inspector's source; this file is the disk-backed, uncapped one.
