import { afterEach, expect, it, vi } from "vitest";
import { createMessageWindowController } from "./message-window";
import { createUnifiedWindowController } from "./unified-window";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = vi.fn(async () => null);
    constructor(label: string, options: unknown) {
      create(label, options);
    }
    async once() {
      return () => {};
    }
  },
}));
vi.mock("../geometry/companion-position", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../geometry/companion-position")>()),
  resolveCompanionPosition: async () => ({ x: 1, y: 2 }),
}));

afterEach(() => {
  create.mockClear();
  vi.unstubAllGlobals();
});

// The companion windows open unfocused; without this the first click on one only activates it.
it("the unified window takes the click that activates it", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  createUnifiedWindowController({ get: () => ({}) as never, reloadFromStorage() {} }).open();
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0]![1]).toMatchObject({ acceptFirstMouse: true });
});

it("the message window takes the click that activates it", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  createMessageWindowController({ get: () => ({}) as never, setMode() {} }).open();
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0]![1]).toMatchObject({ acceptFirstMouse: true });
});
