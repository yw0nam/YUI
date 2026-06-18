# Chat image attachment — design

## Goal
Let the user attach images to a chat message via paste, drag-drop, and a file picker.
Images-only (no documents, no URL link-cards — a URL pasted as text already sends as text).

## Why it's small
The backend wire path already carries images. `encodeInput` (backend-caller.ts) already
emits Responses-API `input_image` content-parts for the screenshot. This feature captures
images at the input and rides that exact path — no new backend contract, no client judgment.

## Data flow

| Layer | File | Change |
|---|---|---|
| Input UI | `src/ui/surfaces.ts` (+`.css`) | Attachment tray (thumbnail chips with × remove) + paperclip button → hidden `<input type=file accept=image/* multiple>`. Handle `paste` and `drop` for image files. `onSubmit` callback gains a 2nd arg `images: string[]` (data URLs). |
| Source | `src/dispatcher/user-input-source.ts` | `submit(text, images?)` → bus payload `{ text, images }`. |
| Contract | `src/contract/types.ts` | `InputContext.user_images?: string[]` — internal data URLs, NOT serialized to the system `client_context` (same rule as `screenshot.data_url`). |
| Backend caller | `src/dispatcher/backend-caller.ts` | read `payload.images` → `ctx.user_images`; `encodeInput` appends one `input_image` part per image, after the optional screenshot part. |
| Wiring | `src/main.ts` | `onSubmit((text, images) => userInput.submit(text, images))`. |

## Behavior
1. Send allowed when text is non-empty **OR** ≥1 image is attached (relaxes the current text-required gate).
2. Capture sources — paste, drag-drop, paperclip picker — all feed one `attachments: string[]` array.
3. Multiple images, no count/size cap. `// ponytail: no count/size cap — add when context-size bites.`
4. Non-image paste/drop items are ignored; URLs stay as typed text.
5. Tray + attachments cleared on submit and on dismiss (same lifecycle as `field.value`).

## Rejected alternative
Upload files for a `file_id` instead of base64 data URLs — Hermes exposes no upload endpoint
in the contract, and the screenshot path proves data URLs already work. Data URLs win.

## UI structure
The input becomes a vertical stack: an attachment tray on top (hidden when empty), then the
existing row. Row gains a leading paperclip button:

```
┌─────────────────────────────────┐
│ [img×] [img×] [img×]            │  ← tray (hidden when empty)
│ 📎  말 걸기…              [error] │  ← row
└─────────────────────────────────┘
```

Tokens already present for this: `--yui-radius-img`, `--yui-radius-chip`, `--yui-scrim`.

## Tests (TDD, written first)
- `surfaces.test.ts`: onSubmit receives images; images-only submit fires; tray clears on
  submit/dismiss; remove-chip drops one image.
- `user-input-source.test.ts`: `submit(text, images)` puts images on the payload.
- `backend-caller.test.ts`: `payload.images` → user `input_image` parts; data URLs absent from
  the system `client_context` string.
