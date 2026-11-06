import { wireTerminalTab } from "../../../src/app/threads-window/wire-terminal-tab";
import { createDelegationChipSettings } from "../../../src/settings/panels/delegation-chip-settings";
import { createThreadsChip } from "../../../src/ui/threads/chip/threads-chip";
import { createThreadsView } from "../../../src/ui/threads/window/threads-view";
import { readPet, surfaces } from "../character/overlays";
import { desk, threadsWin } from "../shared/dom";
import { store } from "./thread-store";
import { createThreadsBox } from "./threads-box";

const box = createThreadsBox({ win: threadsWin, desk, pet: readPet });
const chip = createThreadsChip({
  mount: surfaces.chipColumn,
  collapsed: createDelegationChipSettings(),
  async onOpen(r) {
    const at = box.open(r);
    chip.setWindowOpen(true);
    await view.open(at);
  },
});
const view = createThreadsView({
  mount: threadsWin,
  now: Date.now,
  onAnswer: (id, askId, ans) => store.answer(id, askId, ans),
  onSeen() {},
  onRead: (id) => store.read(id),
  async onClose() {
    if (!box.close()) return;
    await view.close();
    box.hide();
    chip.setWindowOpen(false);
  },
  listCollapsed: false,
  onListCollapsed() {},
  listWidth: null,
  onListWidth() {},
  onTurnsLevel() {},
  resize: box.resize,
  terminal: wireTerminalTab({
    register() {},
    settings: { terminalFontSize: () => 13, setTerminalFontSize() {} },
  }),
});
store.subscribe((s) => {
  view.update(s);
  chip.update(s.threads);
});
// The Threads view receives its window keys only while its window is open.
document.addEventListener(
  "keydown",
  (e) => {
    if (
      !box.isOpen() &&
      (/^[1-9]$/.test(e.key) ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        (e.ctrlKey && e.metaKey))
    )
      e.stopImmediatePropagation();
  },
  { capture: true },
);
view.onHeadPointerDown(box.drag);

export const readThreadsWindow = box.read;
export const resizeThreadsWindow = box.fitToWorkArea;
