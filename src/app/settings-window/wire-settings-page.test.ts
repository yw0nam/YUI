import { expect, it, vi } from "vitest";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { wireSettingsPage } from "./wire-settings-page";

type Request = Parameters<Parameters<SettingsBridge["onSettingsPage"]>[0]>[0];

function setup(opts: { boundId: string | null; editing: string; active?: string }) {
  let remote: (r: Request) => void = () => {};
  const off = vi.fn();
  const bridge = {
    onSettingsPage: vi.fn((cb: (r: Request) => void) => {
      remote = cb;
      return off;
    }),
  };
  const select = vi.fn();
  const retarget = vi.fn();
  const dispose = wireSettingsPage({
    bridge,
    boundId: opts.boundId,
    editing: () => opts.editing,
    active: () => opts.active ?? "main-char",
    select,
    retarget,
  });
  return { select, retarget, dispose, off, remote: (r: Request) => remote(r) };
}

it("selects the requested page for the character the window edits", () => {
  const { select, retarget, remote } = setup({ boundId: "a", editing: "a" });

  remote({ preset: "a", page: "hist" });

  expect(select).toHaveBeenCalledExactlyOnceWith("hist");
  expect(retarget).not.toHaveBeenCalled();
});

it("does nothing for a request without a page when it already edits that character", () => {
  const { select, retarget, remote } = setup({ boundId: "a", editing: "a" });

  remote({ preset: "a" });

  expect(select).not.toHaveBeenCalled();
  expect(retarget).not.toHaveBeenCalled();
});

it("switches back to the opener's character, carrying the page", () => {
  const { select, retarget, remote } = setup({ boundId: "a", editing: "b" });

  remote({ preset: "a", page: "conn" });

  expect(retarget).toHaveBeenCalledExactlyOnceWith("a", "conn");
  expect(select).not.toHaveBeenCalled();
});

it("resolves the main window's request to the active character", () => {
  const { select, retarget, remote } = setup({
    boundId: null,
    editing: "other",
    active: "main-char",
  });

  remote({ preset: null });

  expect(retarget).toHaveBeenCalledExactlyOnceWith("main-char", undefined);
  expect(select).not.toHaveBeenCalled();
});

it("ignores a request for another window's character", () => {
  const { select, retarget, remote } = setup({ boundId: "a", editing: "a" });

  remote({ preset: "b", page: "conn" });
  remote({ preset: null, page: "conn" });

  expect(select).not.toHaveBeenCalled();
  expect(retarget).not.toHaveBeenCalled();
});

it("stops listening on dispose", () => {
  const { dispose, off } = setup({ boundId: null, editing: "x" });

  dispose();

  expect(off).toHaveBeenCalledOnce();
});
