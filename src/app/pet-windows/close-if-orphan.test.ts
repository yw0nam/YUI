import { expect, it, vi } from "vitest";
import { createLogger } from "../../logger";
import { closeIfOrphan } from "./close-if-orphan";

it.each([true, false])("closes only unlisted bound ids: %s", (listed) => {
  const close = vi.fn(),
    log = createLogger("test"),
    info = vi.spyOn(log, "info");
  expect(
    closeIfOrphan({
      boundId: "a",
      registry: {
        get: () => ({ list: listed ? [{ id: "a", name: "A" }] : [], active: "default" }),
      },
      close,
      log,
    }),
  ).toBe(!listed);
  expect(close).toHaveBeenCalledTimes(listed ? 0 : 1);
  if (!listed) expect(info).toHaveBeenCalledWith("preset_window_orphan", { preset: "a" });
});
