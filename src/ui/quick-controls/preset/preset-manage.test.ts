// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createPresetRegistry } from "../../../settings/preset/preset-registry";
import { createPresetManage } from "./preset-manage";

afterEach(() => vi.unstubAllGlobals());
it("copies the current preset URL, hides when disabled and shows fallback on failure", async () => {
  localStorage.clear();
  const registry = createPresetRegistry({ newId: () => "abcd1234" });
  registry.create("companion");
  const el = document.createElement("div");
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  let port: number | null = null;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manage = createPresetManage({
    el,
    registry,
    log,
    presetUrl: (id) => (port ? `http://127.0.0.1:${port}/presets/${id}/signals` : null),
  });
  manage.render();
  expect(el.querySelector(".yui-preset-row__url")).toBeNull();
  port = 9000;
  manage.render();
  expect(el.querySelector('[data-preset-id="default"] .yui-preset-row__url')).toBeNull();
  expect(el.querySelector('[data-preset-id="abcd1234"] .yui-preset-row__url')).not.toBeNull();
  el.querySelector<HTMLButtonElement>(".yui-preset-row__url")!.click();
  expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:9000/presets/abcd1234/signals");
  writeText.mockRejectedValueOnce(new Error("denied"));
  port = 9100;
  manage.render();
  el.querySelector<HTMLButtonElement>(".yui-preset-row__url")!.click();
  await vi.waitFor(() =>
    expect(el.querySelector(".yui-preset-row__url-text")?.textContent).toBe(
      "http://127.0.0.1:9100/presets/abcd1234/signals",
    ),
  );
  expect(log.warn).toHaveBeenCalledWith("ingress_url_copy_failed", expect.any(Object));
  vi.stubGlobal("navigator", {});
  manage.render();
  el.querySelector<HTMLButtonElement>(".yui-preset-row__url")!.click();
  expect(el.querySelector(".yui-preset-row__url-text")).not.toBeNull();
  registry.dispose();
});
