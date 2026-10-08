# Contributing to YUI

Thanks for helping build YUI. This is the single contributor guide;
[`AGENTS.md`](AGENTS.md) carries the project orientation and the on-demand
docs index.

## Toolchain

- **pnpm 11** — the version pinned in `packageManager` (`package.json`)
- **Node.js 22** — what CI runs on
- **Rust + the [Tauri v2 toolchain](https://v2.tauri.app/start/prerequisites/)** —
  needed only for `src-tauri/**` changes and for running the app in the Tauri
  shell; `pnpm dev` (browser-only), `pnpm test`, and `pnpm build` need no Rust

## Quick start

```bash
git clone https://github.com/yw0nam/YUI && cd YUI
pnpm install
pnpm tauri dev    # transparent desktop-pet window
```

A coding agent can walk the setup from
[`docs/guide/install.md`](docs/guide/install.md). A default VRM ships in the
repo; the backend agent, TTS, and STT are **separate
repositories** and optional (the Expression Broker, also separate, is deprecated
and removed in v0.6.0) — see
[`docs/guide/getting-started.md`](docs/guide/getting-started.md).

## Workflow

- **Worktree → PR.** All work lands via PR; `main` is protected and requires
  green CI. Work in a worktree, never on `main` directly:

  ```bash
  git worktree add ../YUI-my-topic -b my-topic
  bash scripts/worktree-setup.sh ../YUI-my-topic
  ```

  The setup script links gitignored runtime assets (VRM, motions) and copies
  `.env.local` from the main checkout; a missing source is skipped.

- **Tests accompany behavior.** New or changed behavior ships its test in the
  same PR. Write the failing test first (`test:`), then the implementation
  (`feat:`), then refactor if needed (`refactor:`). The `test-guard` CI job
  enforces this and passes changes of 20 or fewer added source lines, so tiny
  fixes go without a test. The `skip-tests` label bypasses the job for
  genuinely test-free changes (docs, config); it takes effect on the next
  `test-guard` run, so re-run the job after labelling.
- **English on the tracker.** Issues, issue comments, and PR titles/bodies are
  written in English (chat in any language). The `pr-title` CI job enforces
  English for PR titles.
- **UI: review existing → propose → mock → implement.** Read the existing
  `src/ui/` screens plus [`DESIGN.md`](DESIGN.md) and [`PRODUCT.md`](PRODUCT.md)
  before any UI work; propose the text structure, get confirmation, build a
  standalone mock HTML, then implement.
- **Verify before asking.** Anything observable (UI rendering, DOM state, logs)
  — verify it yourself and attach the proof to the PR's **Runtime evidence**
  section; ask the user only for what genuinely requires them (audio playback,
  physical input feel).

## Code rules

- **Comments: minimal, present-tense only.** One line, only what the code
  cannot say itself — no decision history, spec citations, or issue numbers. A
  numeric constant's comment may name the measurement it came from.
- **Docs: current-state only.** Write what the system *is*, declaratively,
  matching the code — no change narrative, no PR/issue numbers as prose, no
  dated changelogs, no future/unbuilt work.

## Deprecation

Users and their backends depend on what a tagged release carries: config keys
under `configs/`, stored settings, the contract in `docs/reference/`, and each
transport's behaviour. Dropping or replacing one of these takes two PRs in two
releases. Internal modules, names, and file layout carry no such promise and
change freely.

The PR that deprecates a path keeps it working and adds:

- **A removal release.** The path is deleted in the next minor release after
  the one that first ships the warning, or a later one: a path deprecated in
  v0.5.0 is deleted in v0.6.0 at the earliest.
- **A comment** at the path, in this exact form so that
  `grep -rn "Deprecated: removed in"` lists every pending removal:

  ```ts
  // Deprecated: removed in v0.6.0. Use <replacement>.
  ```

- **A warning.** Using the path logs one `warn` per launch through the project
  logger, with the same facts as fields:

  ```ts
  log.warn("deprecated", { what: "broker_base_url", removed_in: "v0.6.0", use: "client-declared tools" });
  ```

- **A doc line.** The doc that describes the path states the removal release
  and the replacement.
- **The `deprecation` label** on the PR, which lists it under **Deprecations**
  in the generated release notes. The PR summary names the path, the removal
  release, and the replacement.

The comment and the doc line are the one place a comment or a doc names a
future release.

The PR that deletes the path lands in the named release, removes the path with
its comment, warning, and doc line together, and carries the `removal` label,
which lists it under **Removed** in the release notes.

## Client anti-patterns

- **No brain in the client.** Judgment, persona, and speak/don't-speak
  decisions belong to the backend; the client fires candidate events and
  renders whatever text arrives.
- **No inline control tags.** Emotion and motion travel only as
  `generate_express` tool-call arguments — never as inline tokens in speech
  text.
- **No hardcoding.** Endpoints, models, VRM paths, and motion sets live in
  `configs/`.
- **No unverified assumptions.** Check the docs and the running behavior
  first; record what you had to decide in the docs before implementing.
- **No transport-private feature copy.** A feature lives in the shared
  consumer; a transport's wiring only maps its own frames or stream events onto
  it.

## Finding your way

Why is the code the way it is? Start with `git blame <file>`; when blame lands
on a move or refactor commit, find where the token first appeared:

```bash
git log -S'<token>' --reverse
```

## Reporting issues

Open an issue with the matching template: **bug**, **feature / task**, or
**spike** (`.github/ISSUE_TEMPLATE/`).

## Taking an issue

Issues labelled
[`help wanted`](https://github.com/yw0nam/YUI/labels/help%20wanted) are open
to contributors. Ideas for automation and for the character's desktop behavior
start in [Ideas](https://github.com/yw0nam/YUI/discussions/categories/ideas);
an accepted idea becomes a `help wanted` issue.

1. Comment `/take` on an open, unassigned issue. The `Take` workflow assigns
   the issue to you. GitHub lets only maintainers edit assignees and labels by
   hand, so the comment is the way to claim one.
2. On an issue labelled `ready-for-agent`, `/take` also removes that label,
   which is the one coding agents pick their work from.
3. Open the PR within 14 days. A maintainer unassigns an issue that has no PR
   after 14 days, and anyone can take it again.

## Commits & PRs

- Conventional commits: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`,
  `chore:`. The PR title is the squash-merge subject and must be
  conventional-commit format; the `pr-title` CI job enforces it.
- Fill the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — Summary (with the
  why-this-value line for every new constant, threshold, or special-cased
  status), related issues, Runtime evidence, and the verification checklist.

## Before you open a PR

Run the same checks CI does — paste the block from the repo root:

```bash
pnpm test                     # vitest
pnpm typecheck:test           # tsc over the test files
pnpm build                    # tsc + vite build
pnpm docs:build               # vitepress build + dead-link check
pnpm lint                     # biome check (format + lint)
(cd src-tauri && cargo test)  # Rust unit tests
```

`cargo test` is needed only for `src-tauri/**` changes — CI also runs it when
`.github/workflows/ci.yml` itself changes.

## License of contributions

By submitting a contribution, you license it to the project under the
[PolyForm Noncommercial License 1.0.0](LICENSE) and grant YoungWoo Nam the right
to relicense it, including under commercial terms.

## Going deeper

- [`AGENTS.md`](AGENTS.md) — project orientation (architecture, core principle,
  doc index)
- [`docs/guide/getting-started.md`](docs/guide/getting-started.md) — full
  install & backend wiring
- [`PRODUCT.md`](PRODUCT.md) / [`DESIGN.md`](DESIGN.md) — product register +
  design system
