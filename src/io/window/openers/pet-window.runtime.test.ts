import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPetWindowOpener } from "./pet-window";

const { getAllWebviewWindows, getByLabel, create, once, outcome, unlistenCreated, unlistenError } =
  vi.hoisted(() => ({
    getAllWebviewWindows: vi.fn(async () => [
      { label: "main" },
      { label: "pet-a" },
      { label: "settings" },
    ]),
    getByLabel: vi.fn<
      (...args: unknown[]) => Promise<{ once: (...args: unknown[]) => Promise<() => void> } | null>
    >(async () => null),
    outcome: { value: "created" as "created" | "error" | "timeout" },
    unlistenCreated: vi.fn(),
    unlistenError: vi.fn(),
    create: vi.fn(),
    once: vi.fn(async () => () => {}),
  }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getAllWebviewWindows,
  WebviewWindow: class {
    static getByLabel = getByLabel;
    constructor(label: string, options: unknown) {
      create(label, options);
    }
    async once(name: string, cb: (e?: { payload: string }) => void) {
      if (name === "tauri://created" && outcome.value === "created") cb();
      if (name === "tauri://error" && outcome.value === "error") cb({ payload: "create error" });
      return name === "tauri://created" ? unlistenCreated : unlistenError;
    }
  },
}));
beforeEach(() => {
  outcome.value = "created";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("lists pet labels and tolerates a window gone before listener registration", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  const opener = createPetWindowOpener();
  expect(await opener.existing()).toEqual(["a"]);
  const cb = vi.fn();
  const off = await opener.onDestroyed("missing", cb);
  off();
  expect(cb).toHaveBeenCalledTimes(0);
  getByLabel.mockResolvedValue({ once });
  await opener.onDestroyed("a", cb);
  expect(once).toHaveBeenCalledWith("tauri://destroyed", cb);
});
it("creates the bound URL and pet options only when missing", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  const opener = createPetWindowOpener();
  await opener.open("a&b");
  expect(create).toHaveBeenCalledWith(
    "pet-a&b",
    expect.objectContaining({
      url: "index.html?preset=a%26b",
      backgroundThrottling: "disabled",
      transparent: true,
      decorations: false,
    }),
  );
  getByLabel.mockResolvedValue({ once });
  await opener.open("a&b");
  expect(create).toHaveBeenCalledTimes(1);
});
it("browser window discovery is unknown", async () => {
  expect(await createPetWindowOpener().existing()).toBeNull();
  expect(getAllWebviewWindows).toHaveBeenCalledTimes(0);
});

it.each([
  "created",
  "error",
  "timeout",
] as const)("settles creation and removes both listeners: %s", async (mode) => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  outcome.value = mode;
  vi.useFakeTimers();
  const promise = createPetWindowOpener().open("a");
  const result =
    mode === "created"
      ? expect(promise).resolves.toBeUndefined()
      : expect(promise).rejects.toThrow(
          mode === "error" ? "create error" : "pet window creation timed out",
        );
  await vi.advanceTimersByTimeAsync(10000);
  await result;
  expect(unlistenCreated).toHaveBeenCalledTimes(1);
  expect(unlistenError).toHaveBeenCalledTimes(1);
});
