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

/** Two urgent signals, three batched ones, two waiting Threads and one running task. */
function build() {
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
    [4, "urgent"],
    [5, "urgent"],
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
  const detach = attachChipColumn({
    root: surfaces.el,
    column: mount,
    bubble: surfaces.el.querySelector<HTMLElement>(".yui-bubble")!,
    askSlot: surfaces.el.querySelector<HTMLElement>(".yui-ask-slot")!,
  });
  disposers.push(surfaces.dispose, signals.dispose, threads.dispose, tasks.dispose, detach);
  return { surfaces, column: mount, threads, typed };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSTransition) animation.finish();
  }
  await new Promise(requestAnimationFrame);
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
  const { surfaces, column, typed } = build();
  await settle();
  const alone = { transform: getComputedStyle(column).transform, rows: shown(column).length };

  surfaces.beginSpeech();
  surfaces.pushSpeech(
    "- one\n- two\n- three\n- four\n- five\n- six\n- seven\n- eight\n- nine\n- ten",
  );
  surfaces.endSpeech({ defer: true });
  await typed;
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

it("in a 190x284 window folds the rows that still do not fit over an Ask card, urgent rows kept", async () => {
  await page.viewport(190, 284);
  const { surfaces, column, threads } = build();
  surfaces.setAsks([ask]);
  await settle();

  expect({
    rows: shown(column).map((el) =>
      el.matches(".yui-chip-column__fold") ? el.textContent : el.hasAttribute("data-chip-urgent"),
    ),
    threadsSlot: threads.slotRect().height,
  }).toEqual({ rows: [true, true, "+6"], threadsSlot: 32 });
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
