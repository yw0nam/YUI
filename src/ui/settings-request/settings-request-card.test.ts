// @vitest-environment jsdom
/** settings-request-card.test.ts — the Settings request card: agent text as plain text, the time left, and what a re-send keeps. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SettingsRequestFrame } from "../../io/chat/tools/run/settings-request-frame";
import type { SettingsChange } from "../../settings/agent-access/document";
import { setLocale } from "../i18n";
import { createSettingsRequestCard } from "./settings-request-card";

const SCREENSHOT: SettingsChange = {
  path: "privacy.screenshot",
  labelKey: "screenshot.label",
  from: false,
  to: true,
};
const REQUESTS: SettingsChange = {
  path: "privacy.screen_requests",
  labelKey: "screenshot.request_label",
  from: false,
  to: true,
};
const HOSTILE = "<img src=x onerror=alert(1)>";

const frame = (over: Partial<SettingsRequestFrame> = {}): SettingsRequestFrame => ({
  type: "settings_request",
  request_id: "r1",
  name: "Rin",
  changes: [SCREENSHOT, REQUESTS],
  expires_at: 60_000,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  setLocale("en");
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

function build() {
  const mount = document.createElement("div");
  document.body.append(mount);
  const card = createSettingsRequestCard({ mount });
  const q = <E extends Element>(selector: string) => mount.querySelector<E>(selector);
  return {
    mount,
    card,
    texts: () =>
      [
        ...mount.querySelectorAll(
          ".yui-settings-card__title, .yui-settings-card__body :is(p, label)",
        ),
      ].map((el) => el.textContent),
    boxes: () => [...mount.querySelectorAll<HTMLInputElement>("[type=checkbox]")],
    field: () => q<HTMLTextAreaElement>("textarea"),
    timer: () => q<HTMLElement>("[role=timer]"),
    openNote: () =>
      [...mount.querySelectorAll("button")].find((b) => b.textContent === "Add a note")?.click(),
    type: (text: string) => {
      const field = q<HTMLTextAreaElement>("textarea");
      if (!field) return;
      field.value = text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    },
  };
}

it.each([
  ["name", frame({ name: HOSTILE, changes: [SCREENSHOT] }), `${HOSTILE} wants to change settings`],
  ["why", frame({ changes: [SCREENSHOT], why: HOSTILE }), `“${HOSTILE}”`],
  ["label", frame({ changes: [{ ...SCREENSHOT, labelKey: HOSTILE }] }), `${HOSTILE} (off → on)`],
  [
    "value",
    frame({
      changes: [{ path: "x.unknown", labelKey: "screenshot.label", from: "a", to: HOSTILE }],
    }),
    `Attach screenshot (a → ${HOSTILE})`,
  ],
])("prints a hostile %s as plain text and creates no element from it", (_field, value, line) => {
  const c = build();
  c.card.set(value);
  expect(c.texts()).toContain(line);
  expect(c.mount.querySelector("img")).toBeNull();
});

it("turns the time left the danger color under 10 s", () => {
  const c = build();
  c.card.set(frame());
  vi.advanceTimersByTime(50_000);
  expect([c.timer()?.textContent, c.timer()?.classList.contains("is-low")]).toEqual([
    "0:10 left",
    false,
  ]);
  vi.advanceTimersByTime(1_000);
  expect([c.timer()?.textContent, c.timer()?.classList.contains("is-low")]).toEqual([
    "0:09 left",
    true,
  ]);
});

it("keeps the checks, the note and the field for the same request, and starts fresh for a new one", () => {
  const c = build();
  c.card.set(frame());
  c.boxes()[1]?.click();
  c.openNote();
  c.type("only the bubble");
  const field = c.field();

  c.card.set(frame({ expires_at: 30_000 }));
  expect([c.boxes().map((b) => b.checked), c.field() === field, field?.value]).toEqual([
    [false, true],
    true,
    "only the bubble",
  ]);

  c.card.set(frame({ request_id: "r2" }));
  expect([c.boxes().map((b) => b.checked), c.field()?.closest("[hidden]") !== null]).toEqual([
    [false, false],
    true,
  ]);
});

it("cuts a pasted note to 200 characters, counting each emoji as one", () => {
  const c = build();
  c.card.set(frame());
  c.openNote();
  c.type("😀".repeat(201));
  expect([...(c.field()?.value ?? "")].length).toBe(200);
});
