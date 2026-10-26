// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installCloseShortcut } from "./close-shortcut";

function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { cancelable: true, ...init });
  document.dispatchEvent(e);
  return e;
}

afterEach(() => vi.unstubAllGlobals());

describe("installCloseShortcut", () => {
  it("closes on Cmd+W on macOS and swallows the key", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const onClose = vi.fn();
    installCloseShortcut(onClose);
    expect(press({ key: "w", metaKey: true }).defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Ctrl+W elsewhere", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    const onClose = vi.fn();
    installCloseShortcut(onClose);
    press({ key: "W", ctrlKey: true });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores plain W, extra modifiers and the other platform's modifier", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const onClose = vi.fn();
    installCloseShortcut(onClose);
    press({ key: "w" });
    press({ key: "w", metaKey: true, shiftKey: true });
    press({ key: "w", ctrlKey: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing once disposed", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const onClose = vi.fn();
    installCloseShortcut(onClose)();
    press({ key: "w", metaKey: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});
