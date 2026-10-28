# YUI — Build, Run & Logs

## Build / Run

```bash
pnpm install
pnpm dev                    # Vite dev server (fixed port 1420) — browser only
pnpm tauri dev              # Tauri app (fixed port 1420, transparent pet window; both Tauri routes open http://127.0.0.1:<port>, so they share one localStorage origin)
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

In `pnpm dev` (browser only), chat in Responses mode goes through the dev server's `/__backend/<scheme>/<host>/<path>` mount (`scripts/dev-backend-proxy.mjs`), which forwards to the configured `chat_base_url`. The mount is a local forwarder, not an authenticated service: it rejects a cross-site request (`Sec-Fetch-Site` other than `same-origin`, or a foreign `Origin` when that header is absent), removes `Cookie`, `Origin`, `Set-Cookie` and hop-by-hop headers, and forwards `Authorization`. The proxy sends no `Origin`, so a backend must accept server-side API clients without one. Tauri builds call the backend directly.

The `verify` Cargo feature (`pnpm tauri build --debug --features verify`, or `cargo check --features verify` in `src-tauri/`) compiles in `tauri-plugin-wdio-webdriver`, the embedded WebDriver server that WebdriverIO's `@wdio/tauri-service` attaches to with `driverProvider: "embedded"`. The feature is off by default: `pnpm tauri dev`, `pnpm tauri build`, and the release workflow leave the plugin out. A desktop bundle built with it logs `verify_webdriver_enabled port=<port>` at warn level and listens on `127.0.0.1:4445`, or on the port in `TAURI_WEBDRIVER_PORT`, for a WebDriver session that evaluates JavaScript in the app's webviews without authentication, so such a bundle serves local verification only. The plugin exposes no Tauri commands, so no capability names it.

## Release

`bundle.targets` in `src-tauri/tauri.conf.json` is `["dmg", "msi", "nsis"]` — the installers that get shipped. The Tauri bundler intersects that list with what the host platform can build, so macOS produces the `.dmg` and Windows produces `.msi` + NSIS `-setup.exe`.

Releases are cut by the operator with `./scripts/release.sh <major|minor|patch>` on a clean, synced `main` (the script refuses to run for an agent). It bumps the version in `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `package.json` — all three must agree, since the script computes the next version from `Cargo.toml` and the workflow guards on the other two — then commits, tags `vX.Y.Z`, and pushes. From the tag:

1. The `Release` workflow (`.github/workflows/release.yml`) rejects the tag unless `X.Y.Z` matches the version in both files, then creates a **draft** GitHub release named after the tag, builds macOS `aarch64-apple-darwin` and Windows x64 in parallel and uploads every bundle to that draft. The release body lists both platforms as supported.
2. Review the draft on GitHub (the notes are generated from the merged PRs since the previous tag) and publish it manually. Nothing else creates a release for the tag — the workflow's draft is the only one, and CI never publishes.

A tag containing a hyphen (`v0.3.0-rc.1`) drafts as a prerelease; the suffix lives on the tag only, so the guard compares `0.3.0` against the app version. Re-running the workflow for the same tag reuses the existing draft instead of creating a second one.

### macOS signing

Signing and notarization are driven entirely by environment variables read by the Tauri CLI; the workflow exports them only when the corresponding repository secrets are non-empty:

| Secret | Effect |
| --- | --- |
| `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` | The CLI imports the base64 `.p12` into a temporary keychain and signs the bundle. Both are required together. |
| `APPLE_SIGNING_IDENTITY` | Optional. Cross-checks the identity of the imported certificate. |
| `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` | Notarizes and staples the signed `.app`. All three are required together. |

With none of them registered the workflow succeeds and ships an unsigned, un-notarized `.dmg`; users open it once, and when macOS blocks it, allow it under **System Settings → Privacy & Security → Open Anyway**. Registering the secrets turns signing on without touching the workflow.

`bundle.yml` is a separate smoke check: it bundles macOS on every push to `main` and keeps no artifact. It never touches releases.

### Plugin releases

An official plugin is released by pushing the tag `plugin-<id>-v<version>`. The tag, `plugins/<id>/Cargo.toml`, and `plugins/<id>/.claude-plugin/plugin.json` carry the same version, and the workflow rejects the tag when any differs. `plugins/<id>/` holds `Cargo.toml` with the package and binary named `<id>`, a committed `Cargo.lock` (the build runs `--locked`), `.claude-plugin/plugin.json`, and `.mcp.json`.

The `Plugin release` workflow (`.github/workflows/plugin-release.yml`) builds darwin-arm64 and windows-x64 and publishes a release on the tag, not marked latest, so `releases/latest` stays the app. The release holds `<id>-<version>-<platform>.zip` per platform; each zip root is the plugin root: `.claude-plugin/plugin.json`, `.mcp.json`, and `bin/<id>` (`bin/<id>.exe` on Windows).

The workflow then opens a PR that updates the plugin's entry in `plugins/catalog.json`. A PR opened with `GITHUB_TOKEN` starts no checks, so the operator closes and reopens it once (`gh pr close <n> && gh pr reopen <n>`) and then merges it. The repository setting "Allow GitHub Actions to create and approve pull requests" must be on. Before rerunning a failed run, delete the release on the tag and the `catalog/plugin-<id>-v<version>` branch, because `gh release create` and `git push` refuse ones that exist.

The macOS binary is signed and notarized with the same secrets as the app; with none registered it ships unsigned and un-notarized.

## Dev reload

Dev updates reload the whole page. No `import.meta.hot.accept()` boundary exists in `src/`, so Vite falls back to `location.reload()` on every change — partial HMR is not used. The `main.ts` disposer collection serves teardown correctness, not dev-session state preservation.

## Logs

Frontend (`src/logger.ts` → `[YUI][namespace] …`) and Rust (`log` crate) lines are written to per-day files `YUI_YYYY-MM-DD.log`, rotated at midnight in the `YUI_LOG_TZ` timezone and retained 14 days (older dated files are pruned on rotation). Dev (`pnpm tauri dev`): `<repo>/logs/` (gitignored) — tail with `tail -f logs/*.log`. Release (macOS): `~/Library/Logs/com.yui.desktop/`. Levels: dev `debug`, release `warn`; override frontend via `VITE_YUI_LOG_LEVEL` (`debug|info|warn|error`).

### Turn records

Alongside the app log, `turns_YYYY-MM-DD.jsonl` accumulates one JSON line per completed backend turn, one per push `render` frame the client played, and one per fire skipped before becoming a turn — the long-horizon source for speak-rate/suppression measurement, readable with `jq` while the app runs. Same directory, rotation, and 14-day retention as the app log: dev `<repo>/logs/`, release `~/Library/Logs/com.yui.desktop/` (macOS). Written via the Rust `append_turn_record(line)` command; `src/io/chat/record/turn-record-log.ts` builds each line and calls it fire-and-forget, so a failed write never breaks the turn or the fire path.

Three record shapes, distinguished by `type` and `event_name`:

- `{"type":"turn","ts","event_name","trigger_kind","client_context",spoke_text}` — one per completed turn, `ts` the moment the turn completed. `client_context` is the same object sent to the backend; `spoke_text` is `false` when the backend returned no/empty speech or the bare `[SILENT]` token.
- `{"type":"turn","ts","event_name":"push.render","trigger_kind":"push","source","turn_id","segments","spoke_text","queued_behind"}` — one per push `render` frame the client played, `ts` the moment it played. No trigger started it, so it carries no `client_context`: `source` names the backend, `turn_id` the backend's turn, `segments` the frame's segment count, `spoke_text` whether any of them spoke, and `queued_behind` whether speech was still owed and played behind what was already queued.
- `{"type":"skip","ts","source","reason",…}` — one per fire suppressed before it became a turn, `ts` the moment the suppressed candidate arose. `source` names the gate that refused it and decides the remaining field: `"screen"` records carry `transition` (`app_switched` / `long_session`) and a `reason` of `disabled` / `not_present` / `min_gap` / `quiet_after_turn` / `global_gap`; `"dispatcher"` records carry `event_name` and always the reason `global_gap` — the global proactive gap held that fire back.

The capped `yui.context-history` (localStorage, last 20 entries) stays the DevTools Context Inspector's source; this file is the disk-backed, uncapped one.
