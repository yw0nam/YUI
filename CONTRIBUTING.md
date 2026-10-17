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
  written in English (chat in any language). The `pr-title` CI job checks the
  conventional type and that the subject is printable ASCII; English is the
  convention for the rest of the tracker.
- **UI: review existing → propose → mock → implement.** Read the existing
  `src/ui/` screens plus [`DESIGN.md`](DESIGN.md) and [`PRODUCT.md`](PRODUCT.md)
  before any UI work; propose the text structure, get confirmation, build a
  standalone mock HTML, then implement.
- **Verify before asking.** Anything observable (UI rendering, DOM state, logs)
  — verify it yourself and attach the proof to the PR's **Runtime evidence**
  section; ask the user only for what genuinely requires them (audio playback,
  physical input feel).

## Architecture map

[`docs/agent-guide/architecture/map.js`](docs/agent-guide/architecture/map.js)
is the map of the client. Open `index.html` beside it from disk to view it.

[`integrations/hermes/platform/yui/docs/map.js`](integrations/hermes/platform/yui/docs/map.js)
is the map of the Hermes push-transport plugin, in the same format. Its parts
are files of the plugin, and every `.py` file under its `src/` but
`__init__.py` is inside the path of some part. The client and the Hermes
gateway are its two outside boxes, and it has no window graph. The viewer
opens it as `index.html?map=integrations/hermes/platform/yui/docs/map.js`:
`?map=` takes the path of a map file from the repo root, and a map opened
that way has no Compare view. A part with a `map` field links to the map at
that path; the client map's push backend links to the plugin map. A change to
the plugin follows the steps below against the plugin map; step 3's
`pnpm map:base` and Compare view cover the client map only.

- A module is one box of the overview: a named unit of the client with a
  one-line description. Each module of the client sits in one of four groups
  (user I/O, core logic, outside communication, shared state and wiring). The
  user, backend agents, and outside services are boxes outside the groups.
- A part is a folder or file of `src/` or `src-tauri/src` that belongs to one
  module. Every `.ts` and `.rs` source file is inside the path of some part.
- An exchange names what crosses between two parts as the code spells it, its
  kind (call, callback, Tauri event, Tauri command, HTTP, WebSocket frame,
  localStorage, cross-window bridge, user action), the transport it belongs to
  (shared, request, push), and the wiring file that connects the two ends.
- A link is a main path between two modules, drawn as a labelled line. The
  viewer lists every exchange of a module when the module is selected.
- A flow is a numbered sequence of steps between modules, each step naming
  the exchanges behind it.
- The window graph lists the windows and the channels each sends to another.

Every change is presented on the map before its code is written. A change
inside one part is presented as that, in one line, and skips steps 2 to 4. A
change that adds or removes a module, a part, or an exchange, or changes what
crosses an exchange, follows all four.

1. Read the map and name the module and part the change goes into and the
   modules and parts it touches.
2. Present each exchange the change adds, changes, or removes, with the state
   of those modules and exchanges before and after, and agree it in the
   issue's **Architecture map** section. The form is free: a table, a list, a
   before and after sketch, or the viewer.
3. Edit `map.js` in the worktree, run `pnpm map:base`, and open the viewer's
   **Compare with main** view to confirm the difference is the agreed one.
4. Ship the `map.js` change in the same PR as the code. A PR whose code
   changes a module, a part, or an exchange is complete only when `map.js`
   states the shipped result.

`pnpm map:check` fails when:

- a part's path, a part's map file, or an exchange's wiring file does not
  exist;
- a source file is inside no part's path, or a folder sits beside the folders
  of other parts and belongs to none. Source files are `.ts` and `.rs` files
  for the client map and `.py` files for the plugin map;
- a part, a link, an exchange, or a flow step names a missing id, or an id is
  used twice;
- a link has no exchange in its direction, or a flow step cites an exchange
  outside its two modules or of the other transport.

CI runs it in the `web` job.

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
pnpm map:check                # architecture map matches the tree
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
