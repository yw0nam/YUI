// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createBridgeCore } from "./bridge-core";

afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
});
it("captures boot identity, filters foreign/missing tags, preserves unscoped and self filtering", async () => {
  history.replaceState(null, "", "/?preset=a");
  const listeners = new Map<string, (value: unknown) => void>();
  const emit = vi.fn();
  const core = createBridgeCore(
    {
      emit,
      listen: (name, cb) => {
        listeners.set(name, cb);
        return () => {};
      },
    },
    "pet",
  );
  const scoped = vi.fn(),
    shared = vi.fn();
  core.on("scoped", scoped, { scoped: true });
  core.on("shared", shared);
  history.replaceState(null, "", "/?preset=b");
  await core.emit("scoped", 7);
  const envelope = emit.mock.calls[0]![1];
  expect(envelope).toMatchObject({ __preset: "a", __kind: "pet", payload: 7 });
  listeners.get("scoped")!(envelope);
  expect(scoped).not.toHaveBeenCalled();
  for (const tag of [undefined, "b", "a"]) {
    const event = { __src: "other", __kind: "settings", __preset: tag, payload: 8 };
    listeners.get("scoped")!(event);
    listeners.get("shared")!(event);
  }
  expect(scoped).toHaveBeenCalledExactlyOnceWith(8, "settings");
  expect(shared).toHaveBeenCalledTimes(3);
  core.dispose();
});
