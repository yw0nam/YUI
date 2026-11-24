// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SettingsStage } from "../../io/bridge/settings-bridge";

const mocks = vi.hoisted(() => ({
  comeAlong: {
    onStage: vi.fn<(slot: unknown) => Promise<void>>(),
    goHome: vi.fn<() => Promise<void>>(),
    place: vi.fn<() => Promise<void>>(),
  },
  closed: new Map<string, () => void>(),
}));
vi.mock("../../ambient/come-along/come-along", () => ({
  createComeAlong: vi.fn<typeof import("../../ambient/come-along/come-along").createComeAlong>(
    () => mocks.comeAlong,
  ),
}));
vi.mock("../../io/window/pet/window-dock", () => ({
  attachDock: vi.fn(),
  detachDock: vi.fn(),
  setPetPositionPhysical: vi.fn(),
  onSettingsStageClosed: vi.fn<
    typeof import("../../io/window/pet/window-dock").onSettingsStageClosed
  >((label, cb) => {
    mocks.closed.set(label, cb);
    return () => mocks.closed.delete(label);
  }),
}));

import { wireComeAlong } from "./wire-come-along";

const slot = { x: 100, y: 80, width: 400, height: 600, scale: 2 };
let onStage: (stage: SettingsStage) => void;
let resized: () => void;
let released: () => void;
const emitSettingsStageAsk = vi.fn();
const teardowns: Array<() => void> = [];

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  onStage = undefined as never;
  released = () => {};
  mocks.comeAlong.onStage.mockResolvedValue();
  mocks.comeAlong.goHome.mockResolvedValue();
  mocks.comeAlong.place.mockResolvedValue();
});
afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  mocks.closed.clear();
  vi.unstubAllGlobals();
});

async function wire(boundId: string | null, listening: Promise<void> = Promise.resolve()) {
  wireComeAlong({
    boundId,
    onSettingsStage: (cb) => {
      onStage = cb;
      return () => {};
    },
    emitSettingsStageAsk,
    bridgeListening: () => listening,
    locomotion: {
      ready: Promise.resolve(),
      onResizeApplied: (cb: () => void) => {
        resized = cb;
        return () => {};
      },
      onHoldReleased: (cb: () => void) => {
        released = cb;
        return () => {};
      },
      getAvatarExecutor: () => null,
    } as never,
    peek: { active: () => false, exit: async () => {} },
    renderer: {} as never,
    hitTest: { setMoving: vi.fn() },
    register: (teardown) => teardowns.push(teardown),
  });
  await vi.waitFor(() => expect(onStage).toBeTypeOf("function"));
}

it.each([
  [null, null, 1],
  [null, "mio", 0],
  ["mio", "mio", 1],
  ["mio", null, 0],
])("a pet window bound to %j takes the stage slot sent for %j %d times", async (boundId, preset, times) => {
  await wire(boundId);

  onStage({ preset, slot });

  expect(mocks.comeAlong.onStage).toHaveBeenCalledTimes(times);
});

it.each([
  [null, "settings"],
  ["mio", "settings-mio"],
])("a pet window bound to %j goes home when %s closes", async (boundId, label) => {
  await wire(boundId);

  mocks.closed.get(label)?.();

  expect(mocks.comeAlong.goHome).toHaveBeenCalledOnce();
});

it("asks for the stage slot once its listener is in place", async () => {
  let listen!: () => void;
  await wire(
    null,
    new Promise((resolve) => {
      listen = resolve;
    }),
  );
  expect(emitSettingsStageAsk).not.toHaveBeenCalled();

  listen();

  await vi.waitFor(() => expect(emitSettingsStageAsk).toHaveBeenCalledOnce());
});

it("places her on the slot again after a Ctrl+wheel resize", async () => {
  await wire(null);

  resized();

  expect(mocks.comeAlong.place).toHaveBeenCalledOnce();
});

it("places her on the newest slot once another holder, such as the Character menu, lets go", async () => {
  await wire(null);

  released();

  expect(mocks.comeAlong.place).toHaveBeenCalledOnce();
});
