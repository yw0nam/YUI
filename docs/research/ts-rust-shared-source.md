# One source for Rust/TS shared names and limits in a Tauri 2 app

Research for yw0nam/YUI#2152. Date of research: 2026-11-26. Throwaway branch `research/ts-rust-shared-source`; never merged.

## Recommendation

Use **ts-rs** (v12) to generate TypeScript types from the Rust side, and keep the **shared JSON file** pattern the repo already uses for constants.

- Error codes become a Rust `#[serde(rename_all = "snake_case")]` enum. ts-rs exports it as a TS string-literal union, so a `switch` on the TS side is checked by the compiler instead of matched by spelling.
- Event payloads and command argument/return shapes get the same treatment.
- Names, labels, and numeric limits (event names, window labels, `/relations` limits) live in one `src/contract/*.json` file. Rust reads it with `include_str!` and TS imports it, the way `builtin-client-tools.json` already works.
- Do not adopt **tauri-specta** yet. Its own README says the command-collection feature needs a Tauri change that is not in any released Tauri 2 version (see below).

Confidence: high for "tauri-specta is blocked today" (primary source: README plus tag comparison). Medium for ts-rs as the best fit, because nothing here was built or run.

## What the repo depends on (verified in this session)

- `src-tauri/Cargo.toml`: `tauri = "2.11.2"` (line 28), `tauri-build = "2.6.2"` (line 18), `serde` 1 with `derive` (line 22), `serde_json` 1.0 (line 21). No `specta`, `ts-rs`, or `typeshare`.
- `src-tauri/Cargo.lock`: no entry named `specta`, `ts-rs`, `typeshare`, or `tauri-specta`.
- `package.json`: `@tauri-apps/api ^2.11.0`, `@tauri-apps/cli ^2.11.2`, and plugin packages. No generator package.
- Existing shared-data precedent: `src/contract/builtin-client-tools.json` is read by Rust with `include_str!` (`src-tauri/src/mcp_host/snapshot.rs:155`) and imported by TS (`src/io/chat/tools/builtin-client-tools.test.ts:2`). Documented at `docs/agent-guide/project-structure.md:161`.
- Hand-maintained name list: `src-tauri/build.rs` lines 2-62 (`COMMANDS`) must list every command the TS side invokes. Nothing checks it against the TS call sites.
- Keep-in-sync comment that the ticket cites: `src-tauri/src/tray.rs:127` ("Window params mirror src/io/window/openers/settings-window.ts — keep both in sync").
- Error strings matched by spelling: `src/ui/quick-controls/persona/card/card-io.ts:23` (`UNREADABLE_ERRORS` Set with `"card_unreadable"`, `"no card in png"`, `"preset file unreadable"`). The Rust literals are at `src-tauri/src/card_import.rs:123` and `:453` ("no card in png"), `:100`, `:107`, `:464` and `src-tauri/src/preset_file/png_card.rs:9` (both "png malformed"), and `src-tauri/src/preset_file/manifest.rs:6` ("preset file unreadable"). `"png malformed"` is written as a literal in two Rust files, so the Rust side already has its own copy problem.

## Tauri 2 facts the options depend on

Source: https://v2.tauri.app/develop/calling-rust/ and https://v2.tauri.app/develop/calling-frontend/ (fetched 2026-11-26).

- Commands return `Result`. On error the JS promise rejects. Error types must implement `serde::Serialize`. A `String` error arrives as a string. A serde-tagged enum error arrives as an object such as `{ kind, message }`.
- Command names must be unique across modules. Arguments are camelCase by default, and `rename_all` changes that.
- Event payloads must be `Serialize` and `Clone`. Event names: the page states no character restrictions (examples only).
- Channels are generic over the message type (`Channel<DownloadEvent>`).

Source: https://v2.tauri.app/develop/configuration-files/ (fetched 2026-11-26). Platform overlays and `--config` merges are described. The page does not describe importing values from another file into `tauri.conf.json`, and does not mention window width or height.

## Options compared

### 1. ts-rs

- Source: https://github.com/Aleph-Alpha/ts-rs (README, fetched via `gh api`); https://crates.io/crates/ts-rs (API).
- Generates: TypeScript types, unions for Rust enums, `serde` attributes honored (`rename`, `rename-all`, `tag`, `content`, `untagged`, `skip`, `default`, `flatten`). Export happens with `#[ts(export)]` when `cargo test` runs (or via `TS::export_all` in code).
- Constants: the README describes types only. It does not mention exporting `const` values. Not checked against docs.rs. **Unconfirmed.**
- String enums for error codes: `#[serde(rename_all = "snake_case")]` on a unit-variant enum produces a string-literal union. The README says it supports unions from enums. Not exercised here. **Output shape for this repo's exact enums is unverified.**
- Tauri 2: the crate has no Tauri dependency. It works with any `serde` type, so Tauri 2.11.x and the current 2.12.7 are equally fine. Not Tauri-specific; no Tauri test was run.
- Version and maintenance: crate `ts-rs` 12.0.1, published 2026-01-31, about 25.2M downloads. GitHub repo pushed 2026-11-09, latest release v12.0.0 (2026-01-31), MIT, 1,961 stars.
- Build-time cost: export runs as part of `cargo test`. No `build.rs`. Not measured.
- Fit: solves the error-code and payload-shape problem. Does not handle names or numbers.

### 2. tauri-specta (with specta)

- Source: https://github.com/specta-rs/tauri-specta (README and `Cargo.toml` at tag `v2.0.0-rc.29`); https://github.com/specta-rs/specta (README).
- Generates: typed command wrappers, typed event definitions (README: "generating types for events"), and TS via `specta-typescript`. Constants are not mentioned in the README. **Unconfirmed.**
- Tauri 2 support: the README's version table lists Tauri v2 with Specta v2 (docs for `^2.0.0-rc.21`). Stable crate `tauri-specta` on crates.io is still **1.0.2** (Tauri v1). The v2 line is only RC: `2.0.0-rc.29`, published 2026-11-13.
- **Blocker, from the README:** "This needs a Tauri build containing tauri-apps/tauri#15326, which is merged upstream but not yet released; Tauri Specta cannot be released until Tauri ships it." Verified facts: PR tauri-apps/tauri#15326 ("feat: IPC Introspection") merged 2026-11-18. `gh api .../compare/<merge>...tauri-v2.12.7` (and every other `tauri-v2.11.x` and `tauri-v2.12.x` tag) reports the tag is behind the merge commit, so no released Tauri 2 tag contains the change. The repo pins `tauri 2.11.2`.
- Specta standalone: TypeScript exporter is marked stable. String enums export as unions (`export type MyEnum = "A" | "B" | "C"`, README example). Specta itself is pre-1.0 (`specta` crate stable is 1.0.5; RC `2.0.0-rc.28`, 2026-11-05). The README calls the non-TS exporters experimental.
- Maintenance: very active. tauri-specta pushed 2026-11-26. specta pushed 2026-11-24.
- Build-time cost: export runs in debug builds in the README example (`#[cfg(debug_assertions)]`). Not measured.
- Fit: best Tauri-native integration, but unusable on the repo's current Tauri until upstream ships.

### 3. typeshare

- Source: https://github.com/1Password/typeshare (README, `gh api`); https://crates.io/crates/typeshare (API).
- Generates: TypeScript, Swift, Kotlin, and others via `#[typeshare]` attribute; CLI `typeshare ./dir --lang=typescript`. Output is types only. The README does not mention constants. **Unconfirmed as to constants.**
- String enums: the README shows a serde-tagged enum mapping to a TS union. It does not show a unit-variant string-enum example. **Unverified for error codes.**
- Tauri 2: not Tauri-specific. Targets FFI generally.
- Maintenance: crate `typeshare` 1.0.5 published 2026-01-02, about 11.5M downloads. Repo last commit (GitHub API) 2026-01-02, latest release v1.13.4 (2025-12-11). The release and crate version numbering differ, and I did not confirm how they map. Activity is slower than ts-rs and specta. Languages marked `**` in the README carry caveats.
- Build-time cost: a separate CLI run that writes a file. Not measured.
- Fit: types only, no constants, and it adds a CLI step. Not preferred.

### 4. Shared JSON or TOML read by `build.rs` and imported by TS

- Precedent in this repo: `src/contract/builtin-client-tools.json` (see above). Rust reads it with `include_str!`; the test imports it.
- Names, labels, numeric limits: a JSON file holds these directly. Rust reads with `serde_json`, which is already a dependency. TS imports it (Vite and Vitest both load JSON; the repo already does this in a test). No new package.
- Error codes: a JSON list of codes can be checked against the Rust enum in a Rust unit test (`serde_json` round-trip), but the JSON alone does not produce TS types. Pair with ts-rs for types.
- Window sizes: `tauri.conf.json` is read by the Tauri CLI at build time. The Tauri docs do not say whether it can take values from another file; I found no mechanism in the docs. **Unconfirmed.** The safer option is to keep `tauri.conf.json` as the source of truth and have TS import it, then check `tray.rs` and the TS openers against the same JSON in a test. The Rust side reading it at runtime via the app config was not checked.
- `build.rs` generating a TS file: possible, but writes into `src/` from a build script, and CI must run the build to refresh it. Not recommended over the plain JSON import.
- Build-time cost: none beyond the file read. Not measured.

### 5. CI diff check (no generator)

- A script or test that extracts Rust string literals and TS constants and compares them. No library involved.
- Cheapest, but matches text, so it misses renames that keep the spelling and catches only what the script's pattern covers. Useful as a backstop for the JSON approach, not as the primary mechanism.

## Summary table

| Option | Types | Constants / names | Tauri 2 status (2026-11-26) | Maintenance | String enums for error codes |
|---|---|---|---|---|---|
| ts-rs 12.0.1 | yes | not in README (unconfirmed) | Not Tauri-specific; works | active (pushed 2026-11-09) | union from enum + serde rename (README) |
| tauri-specta rc.29 | yes (commands, events) | not in README | blocked: needs unreleased Tauri (PR #15326 not in any tag) | very active | union (specta README) |
| specta (standalone) | yes | not in README | TS exporter stable; crate pre-1.0 | active | union (README) |
| typeshare 1.0.5 | yes | not in README | not Tauri-specific | slower (last commit 2026-01-02) | not shown for unit variants (unverified) |
| Shared JSON + include_str | no | yes | works; already in repo | n/a | needs a Rust test to check codes |
| CI diff | n/a | text match | works | n/a | text match only |

## Unconfirmed

- ts-rs, specta, typeshare: whether any exports `const` values (none of the READMEs mention it; docs.rs not checked).
- ts-rs and typeshare output for unit-variant string enums in this repo. Not run.
- Whether tauri-specta `rc.29` builds against the repo's `tauri 2.11.2` (the README says it needs the unreleased Tauri change; not built).
- Whether `tauri.conf.json` window sizes can be sourced from another file (not in the Tauri docs).
- Build-time cost of every option (not measured).
