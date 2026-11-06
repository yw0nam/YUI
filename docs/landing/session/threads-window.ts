import { wireTerminalTab } from "../../../src/app/threads-window/wire-terminal-tab";
import type { ScreenRect } from "../../../src/contract/index";
import {
  chipInWindow,
  resizeThreadsBox,
  threadsWindowRect,
} from "../../../src/io/window/geometry/threads-position";
import { createDelegationChipSettings } from "../../../src/settings/panels/delegation-chip-settings";
import { createThreadsChip } from "../../../src/ui/threads/chip/threads-chip";
import { createThreadsView } from "../../../src/ui/threads/window/threads-view";
import { pet, surfaces } from "../character/overlays";
import { K, LH, LW } from "../desk";
import { clamp, desk, threadsWin } from "../shared/dom";
import { store } from "./thread-store";

const chip = createThreadsChip({
  mount: surfaces.chipColumn,
  collapsed: createDelegationChipSettings(),
  onOpen: (r) => openThreads(r),
});
const disposers: (() => void)[] = [];
export const threadsState = {
  box: null as ScreenRect | null,
  box0: { x: 0, y: 0, width: 0, height: 0 } as ScreenRect,
  threadsOpen: false,
};
const workArea = () => ({ x: 0, y: 0, width: LW, height: LH });
const view = createThreadsView({
  mount: threadsWin,
  now: Date.now,
  onAnswer: (id, askId, ans) => store.answer(id, askId, ans),
  onSeen() {},
  onRead: (id) => store.read(id),
  onClose: () => closeThreads(),
  listCollapsed: false,
  onListCollapsed() {},
  listWidth: null,
  onListWidth() {},
  resize: {
    start() {
      threadsState.box0 = { ...threadsState.box! };
    },
    move(edge, dx, dy) {
      threadsState.box = resizeThreadsBox(threadsState.box0, workArea(), edge, dx / K, dy / K);
      placeThreads();
    },
    end() {},
  },
  terminal: wireTerminalTab({
    register: (d) => disposers.push(d),
    settings: { terminalFontSize: () => 13, setTerminalFontSize() {} },
  }),
});
store.subscribe((s) => {
  view.update(s);
  chip.update(s.threads);
});
export function placeThreads() {
  Object.assign(threadsWin.style, {
    left: threadsState.box!.x + "px",
    top: threadsState.box!.y + "px",
    width: threadsState.box!.width + "px",
    height: threadsState.box!.height + "px",
  });
}
async function openThreads(chipRect: ScreenRect) {
  const d = desk.getBoundingClientRect();
  const chipScreen = {
    x: (chipRect.x - d.left) / K,
    y: (chipRect.y - d.top) / K,
    width: chipRect.width / K,
    height: chipRect.height / K,
  };
  threadsState.box =
    threadsState.box ??
    threadsWindowRect({ pet, workArea: workArea(), panel: { width: 880, height: 680 } });
  fitThreadsBox();
  placeThreads();
  threadsWin.hidden = false;
  threadsState.threadsOpen = true;
  chip.setWindowOpen(true);
  await view.open(chipInWindow(chipScreen, threadsState.box));
}
async function closeThreads() {
  if (!threadsState.threadsOpen) return;
  threadsState.threadsOpen = false;
  await view.close();
  threadsWin.hidden = true;
  chip.setWindowOpen(false);
}
document.addEventListener(
  "keydown",
  (e) => {
    if (
      !threadsState.threadsOpen &&
      (/^[1-9]$/.test(e.key) ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        (e.ctrlKey && e.metaKey))
    )
      e.stopImmediatePropagation();
  },
  { capture: true },
);
view.onHeadPointerDown((e) => {
  const start = { x: e.clientX, y: e.clientY, bx: threadsState.box!.x, by: threadsState.box!.y };
  const mv = (ev: PointerEvent) => {
    threadsState.box!.x = clamp(
      start.bx + (ev.clientX - start.x) / K,
      120 - threadsState.box!.width,
      LW - 120,
    );
    threadsState.box!.y = clamp(start.by + (ev.clientY - start.y) / K, 0, LH - 60);
    placeThreads();
  };
  const up = () => {
    removeEventListener("pointermove", mv);
    removeEventListener("pointerup", up);
  };
  addEventListener("pointermove", mv);
  addEventListener("pointerup", up);
});

export function fitThreadsBox() {
  if (!threadsState.box) return;
  threadsState.box!.width = Math.min(threadsState.box!.width, LW - 24);
  threadsState.box!.height = Math.min(threadsState.box!.height, LH - 24);
  threadsState.box!.x = clamp(threadsState.box!.x, 120 - threadsState.box!.width, LW - 120);
  threadsState.box!.y = clamp(threadsState.box!.y, 0, LH - 60);
}
