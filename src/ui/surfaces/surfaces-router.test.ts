// @vitest-environment jsdom
/**
 * surfaces-router.test.ts — one Surfaces facade over two destinations.
 *
 * Every consumer keeps talking to a single `Surfaces`; the router sends the
 * bubble and input halves to whichever side the current mode names, keeps the
 * tool chip and the anchor local, and hides the surface on the side being left
 * when the mode flips.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardrailsFixture } from "../../config/load-test-helpers";
import { createMessageBridge } from "../../io/bridge/message-bridge";
import { createRemoteSurfaces, type RemoteSurfaces } from "../../io/bridge/message-remote";
import type { BridgeTransport } from "../../io/bridge/settings-bridge";
import type { MessageWindowMode } from "../../settings/panels/message-window-settings";
import { createMessagePlate } from "../message/message-plate";
import { createSurfaces, type Surfaces } from "./surfaces";
import { createSurfacesRouter } from "./surfaces-router";

/** The caps configs/guardrails.json delivers through setAttachmentLimits. */
const LIMITS = guardrailsFixture().attachments;

function makeLocal(): Surfaces {
  return {
    el: document.createElement("div"),
    beginSpeech: vi.fn(),
    pushSpeech: vi.fn(),
    endSpeech: vi.fn(),
    finishSpeech: vi.fn(),
    hideSpeech: vi.fn(),
    showTool: vi.fn(),
    finishTool: vi.fn(),
    hideTool: vi.fn(),
    summonInput: vi.fn(),
    dismissInput: vi.fn(),
    isInputOpen: vi.fn(() => false),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    setBusy: vi.fn(),
    showInputError: vi.fn(),
    setAttachmentLimits: vi.fn(),
    setInputEnabled: vi.fn(),
    setInputAnchor: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeRemote(): RemoteSurfaces {
  return {
    beginSpeech: vi.fn(),
    pushSpeech: vi.fn(),
    endSpeech: vi.fn(),
    finishSpeech: vi.fn(),
    hideSpeech: vi.fn(),
    summonInput: vi.fn(),
    dismissInput: vi.fn(),
    isInputOpen: vi.fn(() => false),
    setInputEnabled: vi.fn(),
    setBusy: vi.fn(),
    showInputError: vi.fn(),
    setAttachmentLimits: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    onDock: vi.fn(),
    onOpenSettings: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("createSurfacesRouter", () => {
  let local: Surfaces;
  let remote: RemoteSurfaces;
  let mode: MessageWindowMode;
  let listeners: Array<(m: MessageWindowMode) => void>;
  let router: Surfaces;

  const setMode = (next: MessageWindowMode): void => {
    mode = next;
    for (const cb of listeners) cb(next);
  };

  beforeEach(() => {
    local = makeLocal();
    remote = makeRemote();
    mode = "docked";
    listeners = [];
    router = createSurfacesRouter({
      local,
      remote,
      getMode: () => mode,
      subscribeMode: (cb) => {
        listeners.push(cb);
        return () => {
          listeners = listeners.filter((l) => l !== cb);
        };
      },
    });
  });

  it("sends the bubble ops to the local surfaces while docked", () => {
    router.beginSpeech();
    router.pushSpeech("hi");
    router.endSpeech({ defer: true });
    router.finishSpeech();
    router.hideSpeech();

    expect(local.beginSpeech).toHaveBeenCalledTimes(1);
    expect(local.pushSpeech).toHaveBeenCalledWith("hi");
    expect(local.endSpeech).toHaveBeenCalledWith({ defer: true });
    expect(local.finishSpeech).toHaveBeenCalledTimes(1);
    expect(local.hideSpeech).toHaveBeenCalledTimes(1);
    expect(remote.beginSpeech).not.toHaveBeenCalled();
  });

  it("sends the bubble ops to the remote surfaces while popped, leaving the local ones untouched", () => {
    setMode("popped");
    vi.mocked(local.hideSpeech).mockClear();

    router.beginSpeech();
    router.pushSpeech("hi");
    router.endSpeech();
    router.finishSpeech();
    router.hideSpeech();

    expect(remote.beginSpeech).toHaveBeenCalledTimes(1);
    expect(remote.pushSpeech).toHaveBeenCalledWith("hi");
    expect(remote.endSpeech).toHaveBeenCalledTimes(1);
    expect(remote.finishSpeech).toHaveBeenCalledTimes(1);
    expect(remote.hideSpeech).toHaveBeenCalledTimes(1);
    expect(local.beginSpeech).not.toHaveBeenCalled();
    expect(local.pushSpeech).not.toHaveBeenCalled();
    expect(local.hideSpeech).not.toHaveBeenCalled();
  });

  it("sends the input ops to the side the mode names", () => {
    router.summonInput();
    router.setInputEnabled(false);
    expect(local.summonInput).toHaveBeenCalledTimes(1);
    expect(local.setInputEnabled).toHaveBeenCalledWith(false);

    setMode("popped");
    router.summonInput();
    router.dismissInput();
    expect(remote.summonInput).toHaveBeenCalledTimes(1);
    expect(remote.dismissInput).toHaveBeenCalledTimes(1);
    expect(local.summonInput).toHaveBeenCalledTimes(1);
  });

  it("sends busy to both sides in either mode", () => {
    router.setBusy(true);
    expect(local.setBusy).toHaveBeenCalledWith(true);
    expect(remote.setBusy).toHaveBeenCalledWith(true);

    setMode("popped");
    router.setBusy(false);
    expect(remote.setBusy).toHaveBeenLastCalledWith(false);
    expect(local.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("leaves neither side busy when a turn started popped ends after a dock", () => {
    setMode("popped");
    router.setBusy(true);
    setMode("docked");
    router.setBusy(false);

    expect(remote.setBusy).toHaveBeenLastCalledWith(false);
    expect(local.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("sends the attachment limits to both sides in either mode", () => {
    router.setAttachmentLimits(LIMITS);
    expect(local.setAttachmentLimits).toHaveBeenCalledTimes(1);
    expect(remote.setAttachmentLimits).toHaveBeenCalledTimes(1);
    expect(remote.setAttachmentLimits).toHaveBeenCalledWith(LIMITS);

    setMode("popped");
    router.setAttachmentLimits(LIMITS);
    expect(remote.setAttachmentLimits).toHaveBeenCalledTimes(2);
    expect(local.setAttachmentLimits).toHaveBeenCalledTimes(2);
    expect(local.setAttachmentLimits).toHaveBeenLastCalledWith(LIMITS);
  });

  it("passes the error action through to whichever side owns the input", () => {
    const action = { label: "Open Advanced", onClick: vi.fn() };
    setMode("popped");
    router.showInputError("no backend", action);
    expect(remote.showInputError).toHaveBeenCalledWith("no backend", action);
    expect(local.showInputError).not.toHaveBeenCalled();
  });

  it("keeps the tool ops, the anchor, the element and dispose local in both modes", () => {
    setMode("popped");
    router.showTool("web_search");
    router.finishTool();
    router.hideTool();
    router.setInputAnchor(120);
    router.dispose();

    expect(local.showTool).toHaveBeenCalledWith("web_search");
    expect(local.finishTool).toHaveBeenCalledTimes(1);
    expect(local.hideTool).toHaveBeenCalledTimes(1);
    expect(local.setInputAnchor).toHaveBeenCalledWith(120);
    expect(local.dispose).toHaveBeenCalledTimes(1);
    expect(router.el).toBe(local.el);
  });

  it("reads isInputOpen from the side the mode names", () => {
    vi.mocked(local.isInputOpen).mockReturnValue(true);
    vi.mocked(remote.isInputOpen).mockReturnValue(false);
    expect(router.isInputOpen()).toBe(true);

    setMode("popped");
    expect(router.isInputOpen()).toBe(false);

    vi.mocked(remote.isInputOpen).mockReturnValue(true);
    expect(router.isInputOpen()).toBe(true);
  });

  it("hides the bubble on the side being left when the mode flips", () => {
    setMode("popped");
    expect(local.hideSpeech).toHaveBeenCalledTimes(1);
    expect(remote.hideSpeech).not.toHaveBeenCalled();

    setMode("docked");
    expect(remote.hideSpeech).toHaveBeenCalledTimes(1);
    expect(local.hideSpeech).toHaveBeenCalledTimes(1);
  });

  it("carries an open input over to the side being entered", () => {
    vi.mocked(local.isInputOpen).mockReturnValue(true);

    setMode("popped");

    expect(local.dismissInput).toHaveBeenCalledTimes(1);
    expect(remote.summonInput).toHaveBeenCalledTimes(1);
  });

  it("carries an open input back when the window docks", () => {
    setMode("popped");
    vi.mocked(remote.isInputOpen).mockReturnValue(true);

    setMode("docked");

    expect(remote.dismissInput).toHaveBeenCalledTimes(1);
    expect(local.summonInput).toHaveBeenCalledTimes(1);
  });

  it("summons nothing when the abandoned side had no input open", () => {
    setMode("popped");

    expect(local.dismissInput).not.toHaveBeenCalled();
    expect(remote.summonInput).not.toHaveBeenCalled();
  });

  // The store also carries the window position, so a drag notifies without changing the mode.
  it("leaves both sides alone when a notification carries the same mode", () => {
    for (const cb of listeners) cb("docked");
    expect(local.hideSpeech).not.toHaveBeenCalled();
    expect(remote.hideSpeech).not.toHaveBeenCalled();
  });

  it("fires a submit callback once, whichever side the submit came from", () => {
    const cb = vi.fn();
    router.onSubmit(cb);

    const localSubmit = vi.mocked(local.onSubmit).mock.calls[0][0];
    const remoteSubmit = vi.mocked(remote.onSubmit).mock.calls[0][0];
    localSubmit("from pet", []);
    remoteSubmit("from message", ["data:x"]);

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, "from pet", []);
    expect(cb).toHaveBeenNthCalledWith(2, "from message", ["data:x"]);
  });

  it("fires a stop callback from either side", () => {
    const cb = vi.fn();
    router.onStop(cb);

    vi.mocked(local.onStop).mock.calls[0][0]();
    vi.mocked(remote.onStop).mock.calls[0][0]();

    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("stops listening for mode changes once disposed", () => {
    router.dispose();
    setMode("popped");
    expect(local.hideSpeech).not.toHaveBeenCalled();
  });
});

function createFakeTransport(): BridgeTransport {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    emit(name, payload) {
      for (const cb of [...(listeners.get(name) ?? [])]) cb(payload);
    },
    listen(name, cb) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(cb);
      return () => set!.delete(cb);
    },
  };
}

describe("createSurfacesRouter over the message bridge", () => {
  let disposers: Array<() => void>;

  beforeEach(() => {
    disposers = [];
  });

  afterEach(() => {
    for (const dispose of disposers) dispose();
  });

  function setup(initial: MessageWindowMode) {
    const transport = createFakeTransport();
    const petBridge = createMessageBridge(transport, { windowKind: "pet" });
    const messageBridge = createMessageBridge(transport, { windowKind: "message" });
    let mode = initial;
    const listeners: Array<(m: MessageWindowMode) => void> = [];
    const router = createSurfacesRouter({
      local: makeLocal(),
      remote: createRemoteSurfaces(petBridge),
      getMode: () => mode,
      subscribeMode: (cb) => {
        listeners.push(cb);
        return () => {};
      },
    });
    disposers.push(router.dispose, petBridge.dispose, messageBridge.dispose);

    const setMode = (next: MessageWindowMode): void => {
      mode = next;
      for (const cb of listeners) cb(next);
    };

    /** The message window's surfaces and plate, wired to the bridge as its bootstrap does. */
    const mountMessageWindow = () => {
      const surfaces = createSurfaces({ mount: document.createElement("div") });
      surfaces.onSubmit((text, images) =>
        messageBridge.emitControl({ op: "submit", text, images }),
      );
      const plate = createMessagePlate({
        mount: surfaces.el,
        onDock: () => {},
        startDragging: () => {},
      });
      messageBridge.onSurface((op) => {
        if (op.op === "busy") {
          plate.setBusy(op.busy);
          surfaces.setBusy(op.busy);
        } else if (op.op === "attachment-limits") {
          surfaces.setAttachmentLimits(op.limits);
        }
      });
      disposers.push(plate.dispose, surfaces.dispose);
      messageBridge.emitControl({ op: "ready" });

      const form = surfaces.el.querySelector(".yui-input") as HTMLFormElement;
      return {
        plate,
        form,
        field: surfaces.el.querySelector(".yui-input__field") as HTMLTextAreaElement,
        attachBtn: surfaces.el.querySelector(".yui-input__attach") as HTMLButtonElement,
      };
    };

    return { router, setMode, mountMessageWindow };
  }

  it("unlocks the message window when a turn started popped ends while docked", () => {
    const { router, setMode, mountMessageWindow } = setup("popped");
    const messageWindow = mountMessageWindow();
    const submitted = vi.fn();
    router.onSubmit(submitted);

    router.setBusy(true);
    setMode("docked");
    router.setBusy(false);
    setMode("popped");

    expect(messageWindow.plate.el.dataset.state).toBe("idle");
    expect(messageWindow.form.classList.contains("is-running")).toBe(false);
    messageWindow.field.value = "hi";
    messageWindow.form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(submitted).toHaveBeenCalledWith("hi", []);
  });

  it("shows thinking when the window pops out during a turn started docked", () => {
    const { router, setMode, mountMessageWindow } = setup("docked");
    const messageWindow = mountMessageWindow();

    router.setBusy(true);
    setMode("popped");

    expect(messageWindow.plate.el.dataset.state).toBe("thinking");
    expect(messageWindow.form.classList.contains("is-running")).toBe(true);
  });

  it("brings a window created after a docked start up to date on the limits and busy", () => {
    const { router, setMode, mountMessageWindow } = setup("docked");
    router.setAttachmentLimits(LIMITS);
    router.setBusy(true);
    setMode("popped");

    const messageWindow = mountMessageWindow();

    expect(messageWindow.attachBtn.disabled).toBe(false);
    expect(messageWindow.plate.el.dataset.state).toBe("thinking");
    expect(messageWindow.form.classList.contains("is-running")).toBe(true);
  });
});
