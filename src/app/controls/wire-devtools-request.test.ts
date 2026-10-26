import { expect, it, vi } from "vitest";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { wireDevtoolsRequest } from "./wire-devtools-request";

function setup(boundId: string | null) {
  let remote: () => void = () => {};
  const off = vi.fn();
  const bridge = {
    onOpenDevtools: vi.fn((cb: () => void) => {
      remote = cb;
      return off;
    }),
  } satisfies Pick<SettingsBridge, "onOpenDevtools">;
  const open = vi.fn();
  const dispose = wireDevtoolsRequest({ bridge, boundId, open });
  return { bridge, open, off, dispose, request: () => remote() };
}

it("main opens Developer Tools when the settings window asks", () => {
  const { open, request } = setup(null);

  request();

  expect(open).toHaveBeenCalledOnce();
});

it("a bound pet window does not listen for the request", () => {
  const { bridge, open } = setup("a");

  expect(bridge.onOpenDevtools).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("stops listening on dispose", () => {
  const { dispose, off } = setup(null);

  dispose();

  expect(off).toHaveBeenCalledOnce();
});
