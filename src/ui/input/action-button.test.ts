// @vitest-environment jsdom
/**
 * The composer's action button: stop while a turn runs, send otherwise. Driven through
 * createSurfaces, the mount that composes it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../surfaces/surfaces.css", () => ({}));
vi.mock("../tokens.css", () => ({}));

import { setLocale } from "../i18n";
import { createSurfaces } from "../surfaces/surfaces";
import { noTool } from "../surfaces/test-helpers";

function setup() {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const s = createSurfaces({ tool: noTool, mount });
  return { s, mount, button: () => mount.querySelector<HTMLButtonElement>(".yui-input__send")! };
}

let ui: ReturnType<typeof setup>;

beforeEach(() => {
  setLocale("en");
  ui = setup();
});
afterEach(() => {
  ui.s.dispose();
  ui.mount.remove();
  setLocale("en");
});

describe("action button", () => {
  it("is send by default", () => {
    expect(ui.button().dataset.mode).toBe("send");
    expect(ui.button().type).toBe("submit");
    expect(ui.button().getAttribute("aria-label")).toBe("Send");
  });

  it("is stop while busy, and a click stops instead of submitting", () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    ui.s.onStop(onStop);
    ui.s.onSubmit(onSubmit);

    ui.s.setBusy(true);
    expect(ui.button().dataset.mode).toBe("stop");
    expect(ui.button().type).toBe("button");
    expect(ui.button().getAttribute("aria-label")).toBe("Stop");
    ui.button().click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    ui.s.setBusy(false);
    expect(ui.button().dataset.mode).toBe("send");
  });

  it("re-labels on a locale change", () => {
    setLocale("ko");

    expect(ui.button().getAttribute("aria-label")).toBe("보내기");
  });
});
