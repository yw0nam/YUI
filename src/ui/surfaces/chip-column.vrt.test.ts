// The chip column beside the bubble, the Ask card and the Character menu, measured with the real stylesheets in WebKit.
import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../styles.css";
import type { AccessRequest } from "../../contract";
import { createDelegationsStore } from "../../io/bridge/delegations/delegations-store";
import type { AskFrame } from "../../io/chat/push/push-frames";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import { createDelegationChipSettings } from "../../settings/panels/delegation-chip-settings";
import { createDelegationChip } from "../chips/delegation-chip";
import { shiftOf } from "../chips/fit-sheet";
import { createSignalChips } from "../chips/signal-chips";
import { createSignalChipsModel } from "../chips/signal-chips-model";
import { setLocale } from "../i18n";
import { createThreadsChip } from "../threads/chip/threads-chip";
import { attachChipColumn } from "./chip-column";
import { INTERACTIVE_OVERLAY_SELECTORS } from "./interactive-overlay";
import { createSurfaces } from "./surfaces";
import { noTool } from "./test-helpers";

const disposers: (() => void)[] = [];

beforeEach(async () => {
  setLocale("en");
  document.body.innerHTML =
    '<div id="app"><div class="yui-root"><div class="yui-stage"></div></div></div>';
  await page.viewport(400, 600);
});

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

/** Three batched signals and, unless left out, two urgent ones; two waiting Threads and one running task. */
function build({ urgent = true } = {}) {
  let allShown!: () => void;
  const typed = new Promise<void>((resolve) => {
    allShown = resolve;
  });
  const surfaces = createSurfaces({
    mount: document.querySelector<HTMLElement>(".yui-root")!,
    tool: noTool,
    keepBubbleUntilDismissed: () => true,
    onAllShown: allShown,
  });
  const mount = surfaces.chipColumn;
  const collapsed = createDelegationChipSettings();
  const model = createSignalChipsModel({
    history: { records: () => [], subscribe: () => () => {} },
  });
  const signals = createSignalChips({ mount, model, collapsed });
  for (const [n, delivery] of [
    [1, "batched"],
    [2, "batched"],
    [3, "batched"],
    ...(urgent
      ? ([
          [4, "urgent"],
          [5, "urgent"],
        ] as const)
      : []),
  ] as const) {
    model.add({
      envelope: {
        source: `ci${n}`,
        event_type: "ci.failed",
        delivery,
        event_id: `e${n}`,
        occurred_at: 1,
      },
      items: [],
    });
  }
  const threads = createThreadsChip({ mount, collapsed, onOpen() {}, isDndOn: () => false });
  threads.updateRequests(
    ["r1", "r2"].map(
      (id): AccessRequest => ({
        id,
        terminalId: "t1",
        presetId: "p1",
        kind: "read",
        text: null,
        deadline: Date.now() + 60_000,
      }),
    ),
  );
  const store = createDelegationsStore();
  const ready: PushSocketState = { kind: "ready", chat_id: "c1" };
  const tasks = createDelegationChip({
    mount,
    store,
    collapsed,
    pushState: { getState: () => ready, onState: () => () => {} },
    onOpenSettings() {},
  });
  store.replace([{ id: "d1", title: "work", started_at: Date.now(), state: "running" }]);
  const detach = attachChipColumn(surfaces.el);
  disposers.push(surfaces.dispose, signals.dispose, threads.dispose, tasks.dispose, detach);
  return { surfaces, column: mount, threads, typed, collapsed, model };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  // Entrances (the Ask card's keyframes, the chips' fades and slides) end here; the endless ones run on.
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY) animation.finish();
  }
  await new Promise(requestAnimationFrame);
}

type Built = ReturnType<typeof build>;

/** Shows a bubble at its cap and waits until its line is typed. */
async function showBubble({ surfaces, typed }: Built): Promise<void> {
  surfaces.beginSpeech();
  surfaces.pushSpeech(
    "- one\n- two\n- three\n- four\n- five\n- six\n- seven\n- eight\n- nine\n- ten",
  );
  surfaces.endSpeech({ defer: true });
  await typed;
}

const shown = (column: HTMLElement): HTMLElement[] =>
  [...column.querySelectorAll<HTMLElement>("[data-chip-count], .yui-chip-column__fold")].filter(
    (el) => el.getClientRects().length > 0,
  );
const columnBottom = (column: HTMLElement): number =>
  Math.max(...shown(column).map((el) => el.getBoundingClientRect().bottom));
const chipTargets = (column: HTMLElement): Element[] =>
  INTERACTIVE_OVERLAY_SELECTORS.flatMap((s) => [...document.querySelectorAll(s)]).filter((el) =>
    column.contains(el),
  );

const ask: AskFrame = {
  type: "ask",
  ask: {
    ask_id: "a1",
    prompt: "Run the migration now?",
    choices: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
    text: false,
  },
  expires_at: Date.now() + 600_000,
};

it("sits at its place with nothing under it, and ends 8px above a bubble at its cap", async () => {
  const built = build();
  const { surfaces, column } = built;
  await settle();
  const alone = { transform: getComputedStyle(column).transform, rows: shown(column).length };

  await showBubble(built);
  await settle();
  const bubbleTop = surfaces.el.querySelector(".yui-bubble")!.getBoundingClientRect().top;

  expect({ alone, gap: Math.round(bubbleTop - columnBottom(column)) }).toEqual({
    alone: { transform: "none", rows: 5 },
    gap: 8,
  });
});

it("ends 8px above an Ask card", async () => {
  const { surfaces, column } = build();
  surfaces.setAsks([ask]);
  await settle();
  const cardTop = surfaces.el.querySelector(".yui-ask-card")!.getBoundingClientRect().top;

  expect([Math.round(cardTop - columnBottom(column)), shown(column).length]).toEqual([8, 5]);
});

it("in a 190x284 window over an Ask card keeps the urgent rows and hides the rest, with no room for a +N row", async () => {
  await page.viewport(190, 284);
  const { surfaces, column, threads } = build();
  surfaces.setAsks([ask]);
  await settle();

  expect({
    rows: shown(column).map((el) =>
      el.matches(".yui-chip-column__fold") ? el.textContent : el.hasAttribute("data-chip-urgent"),
    ),
    threadsSlot: threads.slotRect().height,
  }).toEqual({ rows: [true, true], threadsSlot: 32 });
});

it("fades out while the Character menu is open, taking no hits, and returns when it closes", async () => {
  const { surfaces, column } = build();
  await settle();
  const pill = column.querySelector(".yui-sigchip")!.getBoundingClientRect();
  const hit = () =>
    column.contains(document.elementFromPoint(pill.x + pill.width / 2, pill.y + pill.height / 2));
  const state = () => ({
    opacity: getComputedStyle(column).opacity,
    visibility: getComputedStyle(column).visibility,
    hit: hit(),
    targets: chipTargets(column).length,
  });
  const before = state();

  const menu = document.createElement("div");
  menu.className = "yui-cmenu";
  surfaces.el.append(menu);
  await settle();
  const open = state();
  menu.hidden = true;
  await settle();

  expect({ before, open, closed: state() }).toEqual({
    before: { opacity: "1", visibility: "visible", hit: true, targets: 6 },
    open: { opacity: "0", visibility: "hidden", hit: false, targets: 0 },
    closed: { opacity: "1", visibility: "visible", hit: true, targets: 6 },
  });
});

it("with no urgent chip and no row that fits over the Ask card, the +N row alone sits at the column's top", async () => {
  await page.viewport(190, 200);
  const { surfaces, column } = build({ urgent: false });
  surfaces.setAsks([ask]);
  await settle();

  const rows = shown(column);
  expect([
    rows.map((el) => el.textContent),
    Math.round(rows[0]!.getBoundingClientRect().top),
  ]).toEqual([["+6"], 8]);
});

it("the grouped batched pill shows its +N in place of its cross", async () => {
  const { column } = build();
  await settle();

  const grouped = column.querySelector('.yui-sigchip[data-chip-count="3"]')!;
  expect([
    getComputedStyle(grouped.querySelector(".yui-sigchip__x")!).display,
    getComputedStyle(grouped.querySelector(".yui-sigchip__more")!).display,
  ]).toEqual(["none", "block"]);
});

const drawn = (el: Element | null): boolean => el !== null && el.getClientRects().length > 0;

/** What each chip draws: its title parts as drawn or not, and its count's text where one is drawn. */
function looks(column: HTMLElement) {
  const seen = (root: Element, ...selectors: string[]) =>
    selectors.map((s) => drawn(root.querySelector(s)));
  const count = (el: Element | null) => (drawn(el) ? el!.textContent : null);
  const urgent = column.querySelector(".yui-sigchip--urgent")!;
  const grouped = column.querySelector('.yui-sigchip[data-chip-count="3"]')!;
  const threads = column.querySelector(".yui-threadchip")!;
  const task = column.querySelector(".yui-deleg")!;
  const pill = [".yui-sigchip__dot", ".yui-sigchip__src", ".yui-sigchip__text"];
  return {
    urgent: seen(urgent, ...pill, ".yui-sigchip__x"),
    grouped: [
      ...seen(grouped, ...pill, ".yui-sigchip__more"),
      count(grouped.querySelector(".yui-sigchip__count")),
    ],
    threads: [
      ...seen(threads, ".yui-threadchip__marks", ".yui-threadchip__label"),
      count(threads.querySelector(".yui-threadchip__count")),
    ],
    task: [
      ...seen(task, ".yui-deleg__dot", ".yui-deleg__label"),
      count(task.querySelector(".yui-deleg__count")),
    ],
  };
}

it("in a 190x284 window every chip shows only its dot and count, inside the window", async () => {
  await page.viewport(190, 284);
  const { column } = build();
  await settle();

  const rights = shown(column).map((el) => el.getBoundingClientRect().right);
  expect({ ...looks(column), inside: rights.every((right) => right <= 190) }).toEqual({
    urgent: [true, false, false, false],
    grouped: [true, false, false, false, "3"],
    threads: [false, false, "2"],
    task: [true, false, "1"],
    inside: true,
  });
});

it("in a 400x600 window every chip keeps its title", async () => {
  const { column } = build();
  await settle();

  expect(looks(column)).toEqual({
    urgent: [true, true, true, true],
    grouped: [true, true, true, true, null],
    threads: [true, true, "2"],
    task: [true, true, null],
  });
});

it("in a 190x284 window a held-press fold keeps the grouped row's count apart from its dot", async () => {
  await page.viewport(190, 284);
  const { column, collapsed } = build();
  collapsed.setCollapsed(true);
  await settle();

  const grouped = column.querySelector('.yui-sigchip[data-chip-count="3"]')!;
  const dot = grouped.querySelector(".yui-sigchip__dot")!.getBoundingClientRect();
  const count = grouped.querySelector(".yui-sigchip__count")!;
  expect([count.textContent, Math.round(count.getBoundingClientRect().left - dot.right)]).toEqual([
    "3",
    6,
  ]);
});

it("an expanded batched list carried into a 190x284 window keeps an icon-only Collapse pill that closes it", async () => {
  const { column } = build();
  await settle();
  column.querySelector<HTMLElement>(".yui-sigchip > .yui-sigchip__more")!.click();
  await page.viewport(190, 284);
  await settle();

  const collapse = column.querySelector<HTMLElement>(
    ".yui-sigchips__batched > .yui-sigchip__more",
  )!;
  const narrow = {
    drawn: drawn(collapse),
    name: collapse.getAttribute("aria-label"),
    glyph: getComputedStyle(collapse, "::before").content,
    inside: collapse.getBoundingClientRect().right <= 190,
  };
  collapse.click();

  expect({ narrow, closed: column.querySelector(".yui-sigchips__batched") }).toEqual({
    narrow: { drawn: true, name: "Collapse", glyph: '"\u2212"', inside: true },
    closed: null,
  });
});

it("in a 190x284 window the task chip draws its dot then its count in a pill as tall as a signal pill", async () => {
  await page.viewport(190, 284);
  const { column } = build();
  await settle();

  const chip = column.querySelector(".yui-deleg__chip")!.getBoundingClientRect();
  const dot = column.querySelector(".yui-deleg__dot")!.getBoundingClientRect();
  const count = column.querySelector(".yui-deleg__count")!.getBoundingClientRect();
  const pill = column.querySelector(".yui-sigchip")!.getBoundingClientRect();
  expect({
    countAfterDot: count.left >= dot.right,
    countInside: count.top >= chip.top && count.bottom <= chip.bottom && count.right <= chip.right,
    height: [Math.round(chip.height), Math.round(pill.height)],
  }).toEqual({ countAfterDot: true, countInside: true, height: [28, 28] });
});

/** The open details sheet's top and bottom, rounded to the pixel. */
function sheetEdges(): { top: number; bottom: number } {
  const { top, bottom } = document.querySelector(".yui-sigdetails")!.getBoundingClientRect();
  return { top: Math.round(top), bottom: Math.round(bottom) };
}

const TALL = "a long label ".repeat(120);

/** Adds `count` urgent signals labelled `label` and opens the last one's details sheet. */
async function openSheet(
  { column, model }: Built,
  { label, count = 1 }: { label: string; count?: number },
): Promise<void> {
  for (let n = 6; n < 6 + count; n++) {
    model.add({
      envelope: {
        source: `ci${n}`,
        event_type: "ci.failed",
        label,
        delivery: "urgent",
        event_id: `e${n}`,
        occurred_at: 1,
      },
      items: [],
    });
  }
  await settle();
  const last = `ci${5 + count}`;
  [...column.querySelectorAll<HTMLElement>(".yui-sigchip__open")]
    .find((open) => open.textContent?.includes(last))!
    .click();
  await settle();
}

it("a details sheet taller than the window stays inside it when a bubble moves the column up", async () => {
  const built = build();
  await openSheet(built, { label: TALL });

  await showBubble(built);
  await settle();

  expect(sheetEdges()).toEqual({ top: 8, bottom: 592 });
});

it("a details sheet opened over a bubble stays inside the window when the bubble hides", async () => {
  const built = build();
  await showBubble(built);
  await settle();
  await openSheet(built, { label: TALL });

  built.surfaces.hideSpeech();
  await settle();

  expect(sheetEdges()).toEqual({ top: 8, bottom: 592 });
});

it("a lifted details sheet opened over a bubble stays inside the window when the bubble hides", async () => {
  const built = build();
  await showBubble(built);
  await settle();
  await openSheet(built, { label: "short", count: 5 });

  built.surfaces.hideSpeech();
  await settle();

  const { top, bottom } = sheetEdges();
  expect({ top: top >= 8, bottom: bottom <= 592 }, `sheet at ${top}/${bottom}`).toEqual({
    top: true,
    bottom: true,
  });
});

it("a details sheet holds still while the column slides down as the bubble hides", async () => {
  const built = build();
  await showBubble(built);
  await settle();
  await openSheet(built, { label: TALL });

  built.surfaces.hideSpeech();
  for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
  // A tenth in: the column's ease-out curve has run about half its move.
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = Number(animation.effect?.getTiming().duration) / 10;
  }
  const { column } = built;
  const sliding = shiftOf(getComputedStyle(column).transform) !== shiftOf(column.style.transform);

  expect({ sliding, ...sheetEdges() }).toEqual({ sliding: true, top: 8, bottom: 592 });
});
