// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createSettingsStores } from "../../settings/settings-stores";
import { wirePetControls } from "./wire-pet-controls";

const registered: Array<() => void> = [];
afterEach(() => {
  for (const teardown of registered.splice(0)) teardown();
});

function wired() {
  const stores = createSettingsStores();
  registered.push(() => {
    for (const store of Object.values(stores)) store.dispose();
  });
  const deps = {
    stores,
    remoteSurfaces: { onOpenSettings: vi.fn() },
    openSettings: vi.fn(),
    register: (teardown: () => void) => void registered.push(teardown),
  };
  wirePetControls(deps);
  return { deps };
}

it("opens the settings window on Connection when a popped-out surface asks for settings", () => {
  const { deps } = wired();
  const ask = deps.remoteSurfaces.onOpenSettings.mock.calls[0]![0];

  ask();

  expect(deps.openSettings).toHaveBeenCalledExactlyOnceWith("conn");
});
