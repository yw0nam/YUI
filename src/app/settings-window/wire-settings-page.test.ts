// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../../contract";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { opensOnQuickStart, takeRequestedPage, wireSettingsPage } from "./wire-settings-page";

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
  const wired = wireSettingsPage({
    bridge,
    boundId: opts.boundId,
    editing: () => opts.editing,
    active: () => opts.active ?? "main-char",
    retarget,
  });
  return { select, retarget, wired, off, remote: (r: Request) => remote(r) };
}

afterEach(() => {
  history.replaceState(null, "", "/");
});

it("selects the requested page for the character the window edits", () => {
  const { select, retarget, wired, remote } = setup({ boundId: "a", editing: "a" });
  wired.attach(select);

  remote({ preset: "a", page: "hist" });

  expect(select).toHaveBeenCalledExactlyOnceWith({ page: "hist" });
  expect(retarget).not.toHaveBeenCalled();
});

it("selects the requested page with the key focus for the character the window edits", () => {
  const { select, wired, remote } = setup({ boundId: "a", editing: "a" });
  wired.attach(select);

  remote({ preset: "a", page: "conn", focus: "chat_key" });

  expect(select).toHaveBeenCalledExactlyOnceWith({ page: "conn", focus: "chat_key" });
});

it("switches back to the opener's character, carrying the page and the key focus", () => {
  const { select, retarget, wired, remote } = setup({ boundId: "a", editing: "b" });
  wired.attach(select);

  remote({ preset: "a", page: "conn", focus: "chat_key" });

  expect(retarget).toHaveBeenCalledExactlyOnceWith("a", { page: "conn", focus: "chat_key" });
  expect(select).not.toHaveBeenCalled();
});

it("keeps the key focus asked for before the panel exists and selects it on attach", () => {
  const { select, wired, remote } = setup({ boundId: "a", editing: "a" });

  remote({ preset: "a", page: "conn", focus: "chat_key" });
  wired.attach(select);

  expect(select).toHaveBeenCalledExactlyOnceWith({ page: "conn", focus: "chat_key" });
});

it("does nothing for a request without a page when it already edits that character", () => {
  const { select, retarget, wired, remote } = setup({ boundId: "a", editing: "a" });
  wired.attach(select);

  remote({ preset: "a" });

  expect(select).not.toHaveBeenCalled();
  expect(retarget).not.toHaveBeenCalled();
});

it("switches back to the opener's character, carrying the page", () => {
  const { select, retarget, wired, remote } = setup({ boundId: "a", editing: "b" });
  wired.attach(select);

  remote({ preset: "a", page: "conn" });

  expect(retarget).toHaveBeenCalledExactlyOnceWith("a", { page: "conn" });
  expect(select).not.toHaveBeenCalled();
});

it("resolves the main window's request to the active character", () => {
  const { select, retarget, wired, remote } = setup({
    boundId: null,
    editing: "other",
    active: "main-char",
  });
  wired.attach(select);

  remote({ preset: null });

  expect(retarget).toHaveBeenCalledExactlyOnceWith("main-char", undefined);
  expect(select).not.toHaveBeenCalled();
});

it("ignores a request for another window's character", () => {
  const { select, retarget, wired, remote } = setup({ boundId: "a", editing: "a" });
  wired.attach(select);

  remote({ preset: "b", page: "conn" });
  remote({ preset: null, page: "conn" });

  expect(select).not.toHaveBeenCalled();
  expect(retarget).not.toHaveBeenCalled();
});

it("keeps the latest page asked for before the panel exists and selects it on attach", () => {
  const { select, wired, remote } = setup({ boundId: "a", editing: "a" });

  remote({ preset: "a", page: "voice" });
  remote({ preset: "a", page: "hist" });
  expect(select).not.toHaveBeenCalled();
  wired.attach(select);

  expect(select).toHaveBeenCalledExactlyOnceWith({ page: "hist" });
});

it("stops listening on dispose", () => {
  const { wired, off } = setup({ boundId: null, editing: "x" });

  wired.dispose();

  expect(off).toHaveBeenCalledOnce();
});

it("takes the page of the URL and leaves the rest of the query", () => {
  history.replaceState(null, "", "/settings.html?preset=a&page=conn&edit=b");

  expect(takeRequestedPage()).toEqual({ page: "conn" });
  expect(location.search).toBe("?preset=a&edit=b");
  expect(takeRequestedPage()).toBeNull();
});

it("takes the page and the key focus of the URL and leaves the rest of the query", () => {
  history.replaceState(null, "", "/settings.html?preset=a&page=conn&focus=chat_key");

  expect(takeRequestedPage()).toEqual({ page: "conn", focus: "chat_key" });
  expect(location.search).toBe("?preset=a");
});

it.each([
  ["no address", { chat_base_url: "" }, true],
  ["an address", { chat_base_url: "http://localhost:8643/v1" }, false],
  ["a config that failed to load", null, false],
])("with %s, opensOnQuickStart is %s", (_, endpoints, shown) => {
  expect(opensOnQuickStart(endpoints as EndpointsConfig | null)).toBe(shown);
});
