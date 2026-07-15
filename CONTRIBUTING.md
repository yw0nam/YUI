# Contributing to YUI

Thanks for helping build YUI. This is the short, human-facing guide;
[`AGENTS.md`](AGENTS.md) carries the project orientation and on-demand docs, and
the `yui-dev-workflow` skill carries the full development work rules and
sub-agent roster.

## Quick start

```bash
git clone https://github.com/yw0nam/YUI && cd YUI
pnpm setup        # interactive: fills configs/endpoints.json + .env.local, checks prereqs & VRM
pnpm install
pnpm tauri dev    # transparent desktop-pet window
```

`pnpm setup` only wires YUI's own config. The backend agent, Expression Broker,
TTS, and STT are **separate repositories** — see [`docs/guide/getting-started.md`](docs/guide/getting-started.md)
for those. Drop a VRM 1.0 model into `resources/vrms/*.vrm` (gitignored).

## Workflow

- **Worktree → PR.** All work lands via PR; `main` is protected and requires
  green CI. Branch from a worktree, never commit to `main` directly.
- **Tests accompany behavior.** New or changed behavior ships its test in the
  same PR. Write the failing test first (`test:`), then the implementation
  (`feat:`), then refactor if needed (`refactor:`). The `test-guard` CI job
  enforces this; the `skip-tests` label bypasses it for genuinely test-free
  changes (docs, config).
- **Verify before asking.** Anything observable (UI, DOM, logs) — verify it
  yourself and attach the proof to the PR's **Runtime evidence** section.

## Reporting issues

Open an issue with the matching template: **bug**, **feature / task**, or
**spike** (`.github/ISSUE_TEMPLATE/`).

## Commits & PRs

- Conventional commits: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`.
  The PR title is the squash-merge subject and must be conventional-commit
  format; the `pr-title` CI job enforces it.
- **English on the tracker.** Issues, issue comments, and PR titles/bodies are
  written in English (chat in any language).
- Fill the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — Summary, related
  issues, Runtime evidence, and the verification checklist.

## Before you open a PR

Run the same checks CI does:

```bash
pnpm test                   # vitest
cd src-tauri && cargo test  # Rust unit tests
pnpm build                  # tsc + vite build
pnpm lint                   # biome
```

## Going deeper

- [`AGENTS.md`](AGENTS.md) — project orientation (architecture, core principle, doc index); the `yui-dev-workflow` skill holds the dev work rules and sub-agent roster
- [`docs/guide/getting-started.md`](docs/guide/getting-started.md) — full install & backend wiring
- [`PRODUCT.md`](PRODUCT.md) / [`DESIGN.md`](DESIGN.md) — product register + design system
