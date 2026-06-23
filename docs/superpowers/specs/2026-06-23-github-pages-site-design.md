# GitHub Pages Site — Design Spec

A multi-page documentation site for YUI, published to GitHub Pages, built with
VitePress. A branded landing (Home) plus an operator on-ramp (Getting Started),
with existing repo docs rendered in place as reference pages.

## Goal

YUI's setup is non-trivial (VRM model + backend agent + expression broker
required; STT/TTS/reference-voice optional). The site exists to do what the
README cannot: a visual branded landing that hooks evaluators, and a curated
multi-page guide that walks operators through the wiring, with integrator and
contributor reference rendered from the docs that already live in the repo.

## Audience and v1 weight

All four visitor types are in scope, but v1 effort is concentrated on the first
two; reference pages are rendered from existing markdown with minimal effort.

| Visitor | What they need | v1 treatment |
|---|---|---|
| Evaluator | "What is this, is it worth trying?" | **Home** — designed |
| Operator | Run YUI on their machine | **Getting Started** — designed |
| Integrator | Connect a backend, add motions/Mods, expression protocol | Reference — existing docs rendered |
| Contributor | Hack on YUI itself | Mostly repo AGENTS.md/docs; GitHub link |

## Framework: VitePress

Chosen over Astro Starlight and mdBook because:

- The repo is already Vite + pnpm, so it fits the toolchain family.
- VitePress is file-based: folder layout maps directly to site URLs, so a
  web-shaped `docs/` tree is the site structure (no duplication).
- The Home page can be a fully custom branded layout.
- Sidebar, search, and dark mode are built in.

## Docs restructure (Diátaxis-shaped)

The current `docs/` is flat, optimized for in-repo development and exploration.
For a file-based site this is restructured into a simplified Diátaxis layout —
**Guide** (how-to) and **Reference** (facts) for public content — while the
already-separated agent-internal docs are excluded from the build. The full
tutorials/explanation quadrants are not created; the public doc set is too small
to justify them (YAGNI).

```
docs/
  .vitepress/                config + custom theme
  index.md                   Home (new — branded landing)
  guide/
    getting-started.md       ← moved from docs/setup.md
  reference/
    backend-contract.md      ← moved from docs/backend_contract.md
    motions.md               ← moved from docs/motions.md
    logging.md               ← moved from docs/logging.md
    tts-emotion/             ← moved from docs/tts_emotion/ (README, fishspeech, irodori)
    mods.md                  ← thin page linking out to Mods/README.md (kept in place)
  agent-guide/               internal — kept as-is, srcExclude from build
  superpowers/               internal — kept as-is, srcExclude from build
```

`Mods/README.md` stays in `Mods/` (its own subsystem with its own CI); the site
links out to it rather than moving it.

### Inbound reference updates (part of the move)

Moving public docs breaks paths that point at the old locations. These must be
updated in the same PR, verified by grep + green tests:

- `AGENTS.md` — on-demand list and roster paths.
- `README.md` — `docs/setup.md` and related links.
- `.claude/agents/*` — code-reviewer, software-architect, technical-writer defs.
- `docs/agent-guide/*` — internal docs that cross-link the moved public docs.
- `docs/tts_emotion/README.md` — self/sibling links.
- **Tests** — `src/config/emotion-text.test.ts` and `tests/hooks/guards.test.ts`
  reference doc paths; update and confirm `pnpm test` passes.

## Information architecture

```
Top nav:  Home · Guide ▾ · Reference ▾ · GitHub ↗   [search] [theme]
```

**Designed fresh (v1):**

- **Home** (`docs/index.md`) — branded "Hearthlight" landing: hero (static
  `yui-hero.png`, swappable for a YouTube embed later), one-paragraph
  "body vs mind" framing, the required/recommended/optional setup map, CTA into
  Getting Started.
- **Getting Started** (`docs/guide/getting-started.md`) — the moved `setup.md`
  (required-vs-optional matrix + install + wiring), links adapted for web.

**Reference (moved markdown, rendered as-is), under the Reference sidebar group:**
Backend Contract, Motions, Logging, TTS Emotion, Mods.

**Excluded from the site (agent-internal):** `docs/agent-guide/**`,
`docs/superpowers/**`.

## Layout and theming

- VitePress root is `docs/` (`docs/.vitepress/`); `srcExclude` hides the internal
  buckets. The app's root-level Vite build is unaffected.
- Theme overrides VitePress CSS variables to the YUI design tokens
  (`DESIGN.md`): warm dark background, Hearth Amber accent used only in moments
  (CTA, link hover), OKLCH neutrals, humanist system sans. Dark-mode-first.
- Home uses a custom layout (not the default VitePress hero template) to carry
  the brand.

## Build and deploy

- GitHub Actions workflow: `vitepress build` → `upload-pages-artifact` →
  `deploy-pages`. Site base path `/YUI/`.
- One-time manual step (user): repo Settings → Pages → Source → "GitHub Actions".
- Published URL: `https://yw0nam.github.io/YUI/`.

## Known work / risks

- The docs move (above) is the main risk surface: inbound path references across
  AGENTS.md, README, `.claude/agents/*`, internal docs, and **two test files**
  must be updated in lockstep. Gate on grep-clean + `pnpm test` green.
- Moved docs use repo-relative links (`../README.md`, `src/...`) that break on
  the web; adjust the included pages' links. VitePress dead-link checking
  surfaces the rest at build time.
- Reference page set is a sidebar config; dropping or adding a page later is
  trivial.

## Out of scope (v1)

- Configuration and Troubleshooting as standalone designed pages (operator depth
  beyond Getting Started).
- Localized (KR/JP) site content; the site ships in English to match the README.
- Rendering the full `docs/` tree; only the curated reference set is included.
