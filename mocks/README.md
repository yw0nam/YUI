# Mocks

Standalone HTML mocks of YUI screens, kept so the next change to a screen starts from its mock instead of a new one. Each mock is the owner-approved picture of a screen; the code in `src/ui/` is still the source of truth for what ships.

- One folder per screen, named as the owner names it: `character-window/`, `settings/`, and so on. One file per feature on that screen.
- A mock links the real stylesheets by relative path (`../../src/ui/tokens.css`, and component CSS such as `../../src/ui/threads/chip/threads-chip.css`) and uses their class names, so a token or component change shows in the mock too. Only mock-only staging (the desktop backdrop, demo controls, animation variants) lives in the mock's own `<style>`.
- Open a mock straight from disk in a browser; it needs no server and no build.
- The mock's header names its issue.
- A mock is written in English; UI strings that already exist use the exact wording in `src/ui/i18n/en.ts`.

| Mock | Screen | Issue |
|---|---|---|
| [`character-window/threads-reaction.html`](character-window/threads-reaction.html) | Character window and Threads window: the character sits on the Threads window when a Thread changes state; animation variants | #1936 |
| [`character-window/do-not-disturb.html`](character-window/do-not-disturb.html) | Character window and tray: the status pill's still moon segment, the tray's Do Not Disturb check item | #1961 |
| [`character-window/rest-and-trigger.html`](character-window/rest-and-trigger.html) | Character window and Character menu: the Rest list with its status row and End now, the Rest, Focus and Quiet pills, the status pill's end, and the trigger line in the bubble's quote slot of a turn she started | #2113 |
| [`character-window/turn-recovery.html`](character-window/turn-recovery.html) | Character window, message window and Settings › Connection: a failed turn's one action beside its unchanged condition text (Change key on a rejected key, Retry on a network drop or stall, Open mic settings on the status pill's Mic blocked), Quick start's connected state with Change key and its Key rejected state, and the status pill's notice for a typed turn that fails after the input closed (option B, chosen over leaving the failure unshown) | #2007 |
| [`settings/card-bundle.html`](settings/card-bundle.html) | Settings, Persona page, Card section: export and import a preset as one `.yui` file, PNG card export | #1937 |
| [`settings/card-drop.html`](settings/card-drop.html) | Settings window: import a preset file or card by dropping it onto the window; drop cover variants, refusal placement, the proposed busy rule | #1940 |
| [`settings/active-hours.html`](settings/active-hours.html) | Settings, Persona page: the Active hours section above the Card section (one row per span: start, end, pace in words, remove; a line explaining the paces; Reset to default once edited); the Proactive page's Proactive gap row with its added hint | #1962 |
| [`settings/proactive-page.html`](settings/proactive-page.html) | Settings, Proactive page: Before (today's page) and After (How often she speaks up on top as a Less / Normal / More segmented control; one switch per source with its details folded under it; Advanced folded with the wait, presence and hourly limits; the two Screen watch waits removed), with a Before → After label legend | #1978 |
| [`settings/proactive-redesign.html`](settings/proactive-redesign.html) | Settings, Proactive page, item by item with Before / After: Thread turns moved into the External signals fold; a day strip (active-hours bands, greeting ticks, her face at now, and the check-in ladder that Less / Normal / More re-spaces) in place of the pace foot line; Workflows moved into the External signals fold behind an Add workflow row, with an inline delete confirm; one number column for every number row, the hourly limits with the total first, and copy fixes; then the whole page after | #2026 |
| [`settings/settings-stage.html`](settings/settings-stage.html) | Settings window, layout A: the 400px stage beside the real panel at the default 1160 × 680 content and the 880 × 640 minimum, both themes, her docked, arriving and stayed states, the stage foot with her name and state (folded to name · state at the minimum), and her caption and page reaction as notes | #2047 |
