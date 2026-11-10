# Mocks

Standalone HTML mocks of YUI screens, kept so the next change to a screen starts from its mock instead of a new one. Each mock is the owner-approved picture of a screen; the code in `src/ui/` is still the source of truth for what ships.

- One folder per screen, named as the owner names it: `character-window/`, `settings/`, and so on. One file per feature on that screen.
- A mock links the real stylesheets by relative path (`../../src/ui/tokens.css`, and component CSS such as `../../src/ui/threads/chip/threads-chip.css`) and uses their class names, so a token or component change shows in the mock too. Only mock-only staging (the desktop backdrop, demo controls, animation variants) lives in the mock's own `<style>`.
- Open a mock straight from disk in a browser; it needs no server and no build.
- The mock's header names its issue.

| Mock | Screen | Issue |
|---|---|---|
| [`character-window/threads-reaction.html`](character-window/threads-reaction.html) | Character window and Threads window: the character sits on the Threads window when a Thread changes state; animation variants | #1936 |
| [`settings/card-bundle.html`](settings/card-bundle.html) | Settings, Persona page, Card section: export and import a preset as one `.yui` file, PNG card export | #1937 |
| [`settings/card-drop.html`](settings/card-drop.html) | Settings window: import a preset file or card by dropping it onto the window; overlay variants, refusal placement, the proposed busy rule | #1940 |
