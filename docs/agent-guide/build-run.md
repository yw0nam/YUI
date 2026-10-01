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

## Android

`src-tauri/gen/android/` holds the Android Studio project that `tauri android init` generates. `src-tauri/tauri.android.conf.json` overrides the desktop config for Android: the identifier is `com.yui.mobile` (debug builds install as `com.yui.mobile.debug`), the one window opens `phone.html`, and the bundled resources are `configs/` plus the default VRM. The generated project carries two hand edits a fresh `tauri android init` would lose: `MainActivity.kt` enables edge-to-edge with transparent dark-style system bars (light status-bar icons over the dark stage), and the manifest's main activity pins `android:screenOrientation="portrait"`.

The phone window's bootstrap is `src/windows/phone-main.ts`. Chat on the phone is the push transport, selected by the effective endpoints: `configs/endpoints.json` merged with the `yui.endpoints` override store, with `chat_api` set to `push` and `chat_base_url` to the gateway. The chat key comes from `VITE_YUI_CHAT_KEY` (the process environment or `.env.local`) or the key store. The phone applies the config once per launch, so an edit to `configs/endpoints.json` takes an app restart. The emulator reaches a host-local gateway at `http://10.0.2.2:<port>`, for example `VITE_YUI_CHAT_KEY=<key> pnpm android:dev` with `"chat_base_url": "http://10.0.2.2:<port>"`.

### Toolchain

1. JDK 21. Gradle 8.14 rejects the JDK 25 that Android Studio bundles with `Unsupported class file major version 69`. `brew install openjdk@21` provides JDK 21.
2. Android SDK and NDK, installed from Android Studio's SDK Manager.
3. Rust Android targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.

The Tauri CLI reads the SDK, NDK, and JDK locations from the environment:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/<version>"
export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
```

### Run

```bash
pnpm android:dev                                         # tauri android dev on the attached device or running emulator; picks the dev port like tauri:dev
pnpm tauri android build --debug --target aarch64 --apk  # Standalone debug APK
```

`pnpm android:dev` runs with `--no-watch`, so a Rust change needs a restart. With one device attached the CLI picks it; `adb devices` lists it. The CLI forwards the dev server's `127.0.0.1` port to the device, and the app loads configs, VRMs, and motions from Vite.

The standalone APK stops at config loading. `resolveAssetUrl` turns a bundled path into an asset-protocol URL, the asset protocol opens files on disk, and Android keeps bundled resources inside the APK.

On the emulator, WebGL output appears only when the AVD runs on the host GPU (`hw.gpu.enabled=yes`, `hw.gpu.mode=host`). The emulator reaches the host at `10.0.2.2`, over cleartext HTTP in debug builds only.

### Desktop-only parts

| Part | Gate | Android error without the gate |
|---|---|---|
| `xcap` and the screen-capture commands (`list_screen_sources`, `capture_screen`) | Non-mobile Cargo target table, `#[cfg(desktop)] mod screenshot` and its commands | E0433 in `xcap`: no `platform` module |
| `tauri-plugin-global-shortcut` | Non-mobile Cargo target table, `#[cfg(desktop)]` registration in `plugins.rs`, permissions in `capabilities/desktop.json` | The crate compiles empty, and capability validation fails with `Permission global-shortcut:allow-register not found` |
| `drag_window` | `#[cfg(desktop)] mod drag` and its command | E0599: no method `start_dragging` |
| `set_click_through` | `#[cfg(desktop)] mod passthrough` and its command | E0599: no method `set_ignore_cursor_events` |
| System tray | `#[cfg(desktop)] mod tray` and its call in `setup.rs` | Tauri defines its `tray` module for desktop only |
| Repo `logs/` directory in debug builds | Desktop-only branch in `app_log::log_dir` | `Read-only file system (os error 30)` on every log write |

The phone window invokes none of the gated commands and plugins, and its logs go to the app's private `logs/` directory (see Logs).

## Release

`bundle.targets` in `src-tauri/tauri.conf.json` is `["dmg", "msi", "nsis"]` — the installers that get shipped. The Tauri bundler intersects that list with what the host platform can build, so macOS produces the `.dmg` and Windows produces `.msi` + NSIS `-setup.exe`.

Releases are cut by the operator with `./scripts/release.sh <major|minor|patch>` on a clean, synced `main` (the script refuses to run for an agent). It bumps the version in `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `package.json` — all three must agree, since the script computes the next version from `Cargo.toml` and the workflow guards on the other two — then commits, tags `vX.Y.Z`, and pushes. From the tag:

1. The `Release` workflow (`.github/workflows/release.yml`) rejects the tag unless `X.Y.Z` matches the version in both files, then creates a **draft** GitHub release named after the tag, builds macOS `aarch64-apple-darwin` and Windows x64 in parallel and uploads every bundle to that draft. The release body labels the Windows artifacts experimental.
2. Review the draft on GitHub (the notes are generated from the merged PRs since the previous tag) and publish it manually. Nothing else creates a release for the tag — the workflow's draft is the only one, and CI never publishes.

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

Frontend (`src/logger.ts` → `[YUI][namespace] …`) and Rust (`log` crate) lines are written to per-day files `YUI_YYYY-MM-DD.log`, rotated at midnight in the `YUI_LOG_TZ` timezone and retained 14 days (older dated files are pruned on rotation). Dev (`pnpm tauri dev`): `<repo>/logs/` (gitignored) — tail with `tail -f logs/*.log`. Release (macOS): `~/Library/Logs/com.yui.desktop/`. Android: the app's private `logs/` directory, read with `adb shell run-as com.yui.mobile.debug cat logs/YUI_YYYY-MM-DD.log`; `adb logcat` also carries the webview console under the `Tauri/Console` tag. Levels: dev `debug`, release `warn`; override frontend via `VITE_YUI_LOG_LEVEL` (`debug|info|warn|error`).

### Turn records

Alongside the app log, `turns_YYYY-MM-DD.jsonl` accumulates one JSON line per completed backend turn and one per fire skipped before becoming a turn — the long-horizon source for speak-rate/suppression measurement, readable with `jq` while the app runs. Same directory, rotation, and 14-day retention as the app log: dev `<repo>/logs/`, release `~/Library/Logs/com.yui.desktop/` (macOS), Android the app's private `logs/`. Written via the Rust `append_turn_record(line)` command; `src/io/chat/turn-record-log.ts` builds each line and calls it fire-and-forget, so a failed write never breaks the turn or the fire path.

Two record shapes, distinguished by `type`:

- `{"type":"turn","ts","event_name","trigger_kind","client_context",spoke_text}` — one per completed turn, `ts` the moment the turn completed. `client_context` is the same object sent to the backend; `spoke_text` is `false` when the backend returned no/empty speech or the bare `[SILENT]` token.
- `{"type":"skip","ts","source","reason",…}` — one per fire suppressed before it became a turn, `ts` the moment the suppressed candidate arose. `source` names the gate that refused it and decides the remaining field: `"screen"` records carry `transition` (`app_switched` / `long_session`) and a `reason` of `disabled` / `not_present` / `min_gap` / `quiet_after_turn` / `global_gap`; `"dispatcher"` records carry `event_name` and always the reason `global_gap` — the global proactive gap held that fire back.

The capped `yui.context-history` (localStorage, last 20 entries) stays the DevTools Context Inspector's source; this file is the disk-backed, uncapped one.
