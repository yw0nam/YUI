// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSettingsStores } from "../../settings/settings-stores";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { wirePetControls } from "./wire-pet-controls";

const registered: Array<() => void> = [];
afterEach(() => {
  for (const teardown of registered.splice(0)) teardown();
});

function wired(
  over: {
    boundId?: string | null;
    anchor?: { x: number; y: number } | null;
    silhouette?: { left: number; right: number; top: number; bottom: number } | null;
  } = {},
) {
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
      getSilhouetteBounds: () => over.silhouette ?? null,
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

it("opens the settings window on Connection when a popped-out surface asks for settings", () => {
  const { deps } = wired();
  const ask = deps.remoteSurfaces.onOpenSettings.mock.calls[0]![0];

  ask();

  expect(deps.openSettings).toHaveBeenCalledExactlyOnceWith("conn");
});
