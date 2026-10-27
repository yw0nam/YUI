// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSettingsStores } from "../../settings/settings-stores";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { wirePetControls } from "./wire-pet-controls";

const registered: Array<() => void> = [];
afterEach(() => {
  for (const teardown of registered.splice(0)) teardown();
});

function wired(over: { boundId?: string | null; anchor?: { x: number; y: number } | null } = {}) {
  const stores = createSettingsStores();
  registered.push(() => {
    for (const store of Object.values(stores)) store.dispose();
  });
  const deps = {
    stage: document.createElement("div"),
    stores,
    renderer: {
      getCharacterAnchor: () => (over.anchor === undefined ? { x: 200, y: 300 } : over.anchor),
      getCharacterWidthPx: () => 100,
    },
    boundId: over.boundId ?? null,
    voiceInputStatus: createVoiceInputStatus(),
    remoteSurfaces: { onOpenSettings: vi.fn() },
    openSettings: vi.fn(),
    quickCardWindow: { open: vi.fn() },
    register: (teardown: () => void) => void registered.push(teardown),
  };
  wirePetControls(deps);
  const rightClick = () => {
    const event = new MouseEvent("contextmenu", { clientX: 12, clientY: 34, cancelable: true });
    deps.stage.dispatchEvent(event);
    return event;
  };
  return { deps, rightClick };
}

it.each([
  // Her anchor x 200 with width 100 spans 150..250; the click's y rides along.
  [
    "main's, with its idle voice input",
    {},
    false,
    { left: 150, right: 250, y: 34, listening: false },
  ],
  [
    "main's, with its live voice input",
    {},
    true,
    { left: 150, right: 250, y: 34, listening: true },
  ],
  [
    "a bound character's, with no listening flag",
    { boundId: "a" },
    true,
    { left: 150, right: 250, y: 34 },
  ],
  [
    "main's, at the click's x when the renderer has no anchor",
    { anchor: null },
    false,
    { left: 12, right: 12, y: 34, listening: false },
  ],
])("a stage right-click sends %s extent to the quick-card window", (_name, over, live, request) => {
  const { deps, rightClick } = wired(over);
  if (live) deps.voiceInputStatus.set("listening");

  const event = rightClick();

  expect(event.defaultPrevented).toBe(true);
  expect(deps.quickCardWindow.open).toHaveBeenCalledExactlyOnceWith(request);
});

it("opens the settings window on Connection when a popped-out surface asks for settings", () => {
  const { deps } = wired();
  const ask = deps.remoteSurfaces.onOpenSettings.mock.calls[0]![0];

  ask();

  expect(deps.openSettings).toHaveBeenCalledExactlyOnceWith("conn");
});

it("stops sending right-clicks once torn down", () => {
  const { deps, rightClick } = wired();

  for (const teardown of registered.splice(0)) teardown();
  rightClick();

  expect(deps.quickCardWindow.open).not.toHaveBeenCalled();
});
