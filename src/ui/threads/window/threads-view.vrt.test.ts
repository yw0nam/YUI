import { beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import "../../../styles.css";
import type { Thread } from "../../../contract";
import { setLocale } from "../../i18n";
import type { TabBody } from "./tab-body";
import { createThreadsView } from "./threads-view";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

const threads: Thread[] = [
  {
    id: "pr-214",
    source: "github",
    title: "Review: add retry to the upload queue",
    state: "input-required",
    entries: [
      {
        role: "agent",
        text: "The retry loop looks right. One question before I approve.",
        at: NOW - 4 * MINUTE,
      },
    ],
    created_at: NOW - 30 * MINUTE,
    updated_at: NOW - 4 * MINUTE,
    entry_count: 1,
  },
  {
    id: "mail-9",
    source: "mail",
    title: "Weekly digest",
    state: "working",
    entries: [{ role: "agent", text: "Collecting this week's mail.", at: NOW - 2 * 60 * MINUTE }],
    created_at: NOW - 3 * 60 * MINUTE,
    updated_at: NOW - 2 * 60 * MINUTE,
    entry_count: 1,
  },
];

// The Terminal tab is not under test: a body with an empty list stands in for it.
const terminal = (): TabBody => {
  const el = document.createElement("div");
  return {
    el,
    list: el,
    head: () => ({ count: "", waiting: false }),
    hasSelection: () => false,
    focusList() {},
    focusRail() {},
    move() {},
    shown() {},
    dispose() {},
  };
};

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
});

const build = () =>
  createThreadsView({
    terminal,
    mount: document.querySelector<HTMLElement>("#app")!,
    now: () => NOW,
    onRead: () => {},
    onClose: () => {},
    listCollapsed: false,
    onListCollapsed: () => {},
    listWidth: null,
    onListWidth: () => {},
    resize: { start: () => {}, move: () => {}, end: () => {} },
    onTurnsLevel: () => {},
  });

it.each(["dawn", "hearth"] as const)("paints the Threads window in %s", async (theme) => {
  const view = build();
  view.update({ revision: 1, threads });
  await view.open(null, "threads", { thread: "pr-214", focus: false });
  await page.viewport(896, 696);
  await document.fonts.ready;
  document.documentElement.dataset.theme = theme;
  await expect
    .element(page.elementLocator(document.querySelector("#app")!))
    .toMatchScreenshot(`threads-${theme}`);
  view.dispose();
});

// The test frame marks an arrow-moved focus :focus-visible; the Threads window does not after a
// pointer open, so the focus the arrow lands is made the same way here.
it("rings the Thread turns row an arrow reaches after a pointer open", async () => {
  const view = build();
  view.update({ revision: 1, threads });
  await view.open(null, "threads", { thread: "pr-214", focus: false });
  await userEvent.click(document.querySelector<HTMLButtonElement>(".yui-threads__turns-button")!);
  const row = document.querySelector<HTMLButtonElement>('[role="radio"][data-level="notable"]')!;
  row.focus({ focusVisible: false });
  expect(row.matches(":focus-visible")).toBe(false);

  expect(getComputedStyle(row).outlineStyle).toBe("solid");
  view.dispose();
});
