// @vitest-environment jsdom
/**
 * The composer's action button: stop while a turn runs, send while there is something to send,
 * and — where the host gives a mic port — the mic otherwise. Driven through createSurfaces, the
 * mount that composes it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../surfaces/surfaces.css", () => ({}));
vi.mock("../tokens.css", () => ({}));

import { guardrailsFixture } from "../../config/load-test-helpers";
import { setLocale, t } from "../i18n";
import { createSurfaces } from "../surfaces/surfaces";
import { noTool } from "../surfaces/test-helpers";

function fakeMic() {
  let wanted = false;
  let live = false;
  const listeners = new Set<() => void>();
  return {
    wanted: () => wanted,
    live: () => live,
    toggle: vi.fn(),
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    set(next: { wanted: boolean; live: boolean }): void {
      wanted = next.wanted;
      live = next.live;
      for (const cb of [...listeners]) cb();
    },
    listenerCount: () => listeners.size,
  };
}

function setup(opts: { mic?: ReturnType<typeof fakeMic>; persistent?: boolean } = {}) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const s = createSurfaces({
    tool: noTool,
    mount,
    persistentInput: opts.persistent ?? true,
    ...(opts.mic ? { mic: opts.mic } : {}),
  });
  s.setAttachmentLimits(guardrailsFixture().attachments);
  const q = <T extends Element>(sel: string): T => mount.querySelector<T>(sel)!;
  return {
    s,
    mount,
    button: () => q<HTMLButtonElement>(".yui-input__send"),
    field: () => q<HTMLTextAreaElement>(".yui-input__field"),
    tray: () => q<HTMLElement>(".yui-input__tray"),
    type(text: string): void {
      const field = q<HTMLTextAreaElement>(".yui-input__field");
      field.value = text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    },
    async attach(): Promise<void> {
      const field = q<HTMLTextAreaElement>(".yui-input__field");
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
        type: "image/png",
      });
      const e = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clipboardData", {
        value: { items: [{ kind: "file", getAsFile: () => file }], getData: () => "" },
      });
      field.dispatchEvent(e);
      const tray = q<HTMLElement>(".yui-input__tray");
      while (tray.children.length === 0) await new Promise((r) => setTimeout(r, 0));
    },
  };
}

let ui: ReturnType<typeof setup>;

beforeEach(() => setLocale("en"));
afterEach(() => {
  ui?.s.dispose();
  ui?.mount.remove();
  setLocale("en");
});

describe("action button — with a mic port", () => {
  it("is the mic on an empty field with no turn running", () => {
    const mic = fakeMic();
    ui = setup({ mic });

    expect(ui.button().dataset.mode).toBe("mic");
    expect(ui.button().type).toBe("button");
    expect(ui.button().getAttribute("aria-label")).toBe(t("phone.voice.start_aria"));
    expect(ui.button().classList.contains("is-live")).toBe(false);
  });

  it("toggles the mic on a click and submits nothing", () => {
    const mic = fakeMic();
    ui = setup({ mic });
    const onSubmit = vi.fn();
    ui.s.onSubmit(onSubmit);

    ui.button().click();

    expect(mic.toggle).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("names the stop and shows live while the mic is on and healthy, and drops live on an error", () => {
    const mic = fakeMic();
    ui = setup({ mic });

    mic.set({ wanted: true, live: true });

    expect(ui.button().getAttribute("aria-label")).toBe(t("phone.voice.stop_aria"));
    expect(ui.button().classList.contains("is-live")).toBe(true);

    mic.set({ wanted: true, live: false });

    expect(ui.button().getAttribute("aria-label")).toBe(t("phone.voice.stop_aria"));
    expect(ui.button().classList.contains("is-live")).toBe(false);
  });

  it("becomes send once the field holds text and the mic again when it empties", () => {
    const mic = fakeMic();
    ui = setup({ mic });

    ui.type("hello");
    expect(ui.button().dataset.mode).toBe("send");
    expect(ui.button().type).toBe("submit");
    expect(ui.button().getAttribute("aria-label")).toBe(t("aria.send"));
    expect(ui.button().classList.contains("is-live")).toBe(false);

    ui.type("   ");
    expect(ui.button().dataset.mode).toBe("mic");
  });

  it("sends instead of toggling when text is present", () => {
    const mic = fakeMic();
    ui = setup({ mic });
    const onSubmit = vi.fn();
    ui.s.onSubmit(onSubmit);
    ui.type("hello");

    ui.button().click();
    ui.button().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(mic.toggle).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith("hello", []);
  });

  it("is send for an attachment and the mic again once it is removed", async () => {
    const mic = fakeMic();
    ui = setup({ mic });

    await ui.attach();
    expect(ui.button().dataset.mode).toBe("send");

    ui.tray().querySelector<HTMLButtonElement>(".yui-chip__remove")!.click();
    expect(ui.button().dataset.mode).toBe("mic");
  });

  it("is send while an attachment is still being read", async () => {
    const mic = fakeMic();
    ui = setup({ mic });
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const e = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", {
      value: { items: [{ kind: "file", getAsFile: () => file }], getData: () => "" },
    });

    ui.field().dispatchEvent(e);

    expect(ui.tray().children.length).toBe(0);
    expect(ui.button().dataset.mode).toBe("send");
    // A read still running after the file's jsdom teardown throws an uncaught error.
    while (ui.tray().children.length === 0) await new Promise((r) => setTimeout(r, 0));
  });

  it("returns to the mic after a submit empties the composer", () => {
    const mic = fakeMic();
    ui = setup({ mic });
    ui.s.onSubmit(() => {});
    ui.type("hello");

    ui.button().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(ui.field().value).toBe("");
    expect(ui.button().dataset.mode).toBe("mic");
  });

  it("returns to send when restoreInput puts a sent message back", () => {
    const mic = fakeMic();
    ui = setup({ mic });

    ui.s.restoreInput("hello", []);

    expect(ui.button().dataset.mode).toBe("send");
  });

  it("returns to the mic when a dismissed composer clears its draft", () => {
    const mic = fakeMic();
    ui = setup({ mic, persistent: false });
    ui.s.summonInput();
    ui.type("draft");
    expect(ui.button().dataset.mode).toBe("send");

    ui.s.dismissInput();
    ui.mount
      .querySelector(".yui-input")!
      .dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }));

    expect(ui.button().dataset.mode).toBe("mic");
  });

  it("is stop while busy, ahead of text and the mic, and stops instead of toggling", () => {
    const mic = fakeMic();
    ui = setup({ mic });
    const onStop = vi.fn();
    ui.s.onStop(onStop);
    ui.type("hello");

    ui.s.setBusy(true);
    expect(ui.button().dataset.mode).toBe("stop");
    expect(ui.button().type).toBe("button");

    ui.type("");
    expect(ui.button().dataset.mode).toBe("stop");
    ui.button().click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(mic.toggle).not.toHaveBeenCalled();

    ui.s.setBusy(false);
    expect(ui.button().dataset.mode).toBe("mic");
  });

  it("re-labels on a locale change", () => {
    const mic = fakeMic();
    ui = setup({ mic });

    setLocale("ko");

    expect(ui.button().getAttribute("aria-label")).toBe(t("phone.voice.start_aria"));
    expect(ui.button().getAttribute("aria-label")).not.toBe("Start voice input");
  });

  it("stops listening to the mic port after dispose", () => {
    const mic = fakeMic();
    ui = setup({ mic });
    expect(mic.listenerCount()).toBe(1);

    ui.s.dispose();

    expect(mic.listenerCount()).toBe(0);
  });
});
