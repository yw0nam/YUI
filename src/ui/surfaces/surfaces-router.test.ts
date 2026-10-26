// @vitest-environment jsdom
/**
 * surfaces-router.test.ts — one Surfaces facade over two destinations.
 *
 * Every consumer keeps talking to a single `Surfaces`; the router sends the
 * bubble and input halves to whichever side the current mode names, keeps the
 * tool status and the anchor local, and hides the surface on the side being left
 * when the mode flips.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardrailsFixture } from "../../config/load-test-helpers";
import type { BridgeTransport } from "../../io/bridge/core/bridge-core";
import { createMessageBridge } from "../../io/bridge/message/message-bridge";
import { createRemoteSurfaces, type RemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { MessageWindowMode } from "../../settings/panels/message-window-settings";
import { createMessagePlate } from "../message/message-plate";
import { createSurfaces, type Surfaces } from "./surfaces";
import { createSurfacesRouter } from "./surfaces-router";
import { noTool } from "./test-helpers";

/** The caps configs/guardrails.json delivers through setAttachmentLimits. */
const LIMITS = guardrailsFixture().attachments;

function makeLocal(): Surfaces {
  return {
    el: document.createElement("div"),
    chipColumn: document.createElement("div"),
    beginSpeech: vi.fn(),
    pushSpeech: vi.fn(),
    paceSpeech: vi.fn(),
    endSpeech: vi.fn(),
    finishSpeech: vi.fn(),
    hideSpeech: vi.fn(),
    showSpeechAction: vi.fn(),
    quoteUser: vi.fn(),
    quoteSignals: vi.fn(),
    settleQuote: vi.fn(),
    clearQuote: vi.fn(),
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
    restoreInput: vi.fn(),
    setInputAnchor: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeRemote(): RemoteSurfaces {
  return {
    beginSpeech: vi.fn(),
    pushSpeech: vi.fn(),
    paceSpeech: vi.fn(),
    endSpeech: vi.fn(),
    finishSpeech: vi.fn(),
    hideSpeech: vi.fn(),
    showSpeechAction: vi.fn(),
    quoteUser: vi.fn(),
    quoteSignals: vi.fn(),
    settleQuote: vi.fn(),
    clearQuote: vi.fn(),
    summonInput: vi.fn(),
    dismissInput: vi.fn(),
    isInputOpen: vi.fn(() => false),
    setBusy: vi.fn(),
    setName: vi.fn(),
    showInputError: vi.fn(),
    setAttachmentLimits: vi.fn(),
    restoreInput: vi.fn(),
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
  let stream: RemoteSurfaces;
  let mode: MessageWindowMode;
  let listeners: Array<(m: MessageWindowMode) => void>;
  let shown: boolean;
  let shownListeners: Array<(shown: boolean) => void>;
  let router: Surfaces;

  const setMode = (next: MessageWindowMode): void => {
    mode = next;
    for (const cb of listeners) cb(next);
  };
  const setShown = (next: boolean): void => {
    shown = next;
    for (const cb of shownListeners) cb(next);
  };

  beforeEach(() => {
    local = makeLocal();
    remote = makeRemote();
    stream = makeRemote();
    mode = "docked";
    listeners = [];
    shown = false;
    shownListeners = [];
    router = createSurfacesRouter({
      local,
      remote,
      stream,
      getMode: () => mode,
      subscribeMode: (cb) => {
        listeners.push(cb);
        return () => {
          listeners = listeners.filter((l) => l !== cb);
        };
      },
      shown: {
        get: () => shown,
        subscribe: (cb) => {
          shownListeners.push(cb);
          return () => {
            shownListeners = shownListeners.filter((l) => l !== cb);
          };
        },
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

  it.each([
    "docked",
    "popped",
  ] as const)("sends nothing but busy to the stream while the unified window is not shown (%s)", (next) => {
    setMode(next);
    const identity = { turn_id: "7", event_name: "user.text_submitted" };
    router.beginSpeech(identity);
    router.pushSpeech("Hello", identity);
    router.endSpeech({ defer: true }, identity);
    router.quoteUser({ text: "hi", via: "text", images: 0 });
    router.summonInput();
    router.setBusy(true);

    const called = Object.entries(stream)
      .filter(([, fn]) => vi.isMockFunction(fn) && fn.mock.calls.length > 0)
      .map(([name]) => name);
    expect(called).toEqual(["setBusy"]);
  });

  it("quoteUser, settleQuote and clearQuote reach the side the mode names", () => {
    const quote = { text: "hi", via: "text" as const, images: 0 };
    router.quoteUser(quote);
    router.settleQuote();
    router.clearQuote();
    expect(local.quoteUser).toHaveBeenCalledWith(quote);
    expect(local.settleQuote).toHaveBeenCalledTimes(1);
    expect(local.clearQuote).toHaveBeenCalledTimes(1);

    setMode("popped");
    router.quoteUser(quote);
    router.settleQuote();
    router.clearQuote();
    expect(remote.quoteUser).toHaveBeenCalledWith(quote);
    expect(remote.settleQuote).toHaveBeenCalledTimes(1);
    expect(remote.clearQuote).toHaveBeenCalledTimes(1);
    expect(local.quoteUser).toHaveBeenCalledTimes(1);
  });

  it("quoteSignals reaches the side the mode names", () => {
    const lines = [{ delivery: "urgent" as const, source: "gh", text: "CI failed" }];
    router.quoteSignals(lines);
    expect(local.quoteSignals).toHaveBeenCalledWith(lines);

    setMode("popped");
    router.quoteSignals(lines);
    expect(remote.quoteSignals).toHaveBeenCalledWith(lines);
    expect(local.quoteSignals).toHaveBeenCalledTimes(1);
  });

  it("restoreInput reaches the input side the mode names", () => {
    router.restoreInput("hi", []);
    expect(local.restoreInput).toHaveBeenCalledWith("hi", []);

    setMode("popped");
    router.restoreInput("again", ["data:image/png;base64,AAAA"]);
    expect(remote.restoreInput).toHaveBeenCalledWith("again", ["data:image/png;base64,AAAA"]);
    expect(local.restoreInput).toHaveBeenCalledTimes(1);
  });

  it("sends the input ops to the side the mode names", () => {
    router.summonInput();
    expect(local.summonInput).toHaveBeenCalledTimes(1);

    setMode("popped");
    router.summonInput();
    router.dismissInput();
    expect(remote.summonInput).toHaveBeenCalledTimes(1);
    expect(remote.dismissInput).toHaveBeenCalledTimes(1);
    expect(local.summonInput).toHaveBeenCalledTimes(1);
  });

  it("sends busy to both sides and the stream in either mode", () => {
    router.setBusy(true);
    expect(local.setBusy).toHaveBeenCalledWith(true);
    expect(remote.setBusy).toHaveBeenCalledWith(true);
    expect(stream.setBusy).toHaveBeenCalledWith(true);

    setMode("popped");
    router.setBusy(false);
    expect(remote.setBusy).toHaveBeenLastCalledWith(false);
    expect(local.setBusy).toHaveBeenLastCalledWith(false);
    expect(stream.setBusy).toHaveBeenLastCalledWith(false);
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

  describe("while the unified window shows", () => {
    const identity = { turn_id: "7", event_name: "user.text_submitted" };

    it("sends a turn's line to the stream only", () => {
      setShown(true);
      vi.mocked(local.hideSpeech).mockClear();
      vi.mocked(remote.hideSpeech).mockClear();

      router.beginSpeech(identity, { paced: true });
      router.pushSpeech("Hello", identity);
      router.paceSpeech({ text: "Hello", durationMs: 800 });
      router.endSpeech({ defer: true }, identity);
      router.finishSpeech();
      router.hideSpeech();

      expect(stream.beginSpeech).toHaveBeenCalledWith(identity, { paced: true });
      expect(stream.pushSpeech).toHaveBeenCalledWith("Hello", identity);
      expect(stream.paceSpeech).toHaveBeenCalledWith({ text: "Hello", durationMs: 800 });
      expect(stream.endSpeech).toHaveBeenCalledWith({ defer: true }, identity);
      expect(stream.finishSpeech).toHaveBeenCalledOnce();
      expect(stream.hideSpeech).toHaveBeenCalledOnce();
      for (const side of [local, remote]) {
        expect(side.beginSpeech).not.toHaveBeenCalled();
        expect(side.pushSpeech).not.toHaveBeenCalled();
        expect(side.hideSpeech).not.toHaveBeenCalled();
      }
    });

    it("sends an aside to the stream", () => {
      setShown(true);

      router.beginSpeech(undefined, { paced: true, aside: true });
      router.pushSpeech("Wait.");

      expect(stream.beginSpeech).toHaveBeenCalledWith(undefined, { paced: true, aside: true });
      expect(stream.pushSpeech).toHaveBeenCalledWith("Wait.");
      expect(local.beginSpeech).not.toHaveBeenCalled();
    });

    it("keeps a notice and its action on the character's own bubble", () => {
      setShown(true);
      const action = { label: "Open Connection", onClick: () => {} };

      router.beginSpeech();
      router.pushSpeech("Connect a backend first.");
      router.showSpeechAction(action);
      router.endSpeech();

      expect(local.beginSpeech).toHaveBeenCalledOnce();
      expect(local.pushSpeech).toHaveBeenCalledWith("Connect a backend first.");
      expect(local.showSpeechAction).toHaveBeenCalledWith(action);
      expect(local.endSpeech).toHaveBeenCalledOnce();
      expect(stream.beginSpeech).not.toHaveBeenCalled();
    });

    it("sends the quote ops to the stream", () => {
      setShown(true);
      const quote = { text: "hi", via: "text" as const, images: 0, mention: "everyone" as const };
      const lines = [{ delivery: "urgent" as const, source: "ci", text: "Build failed" }];

      router.quoteUser(quote);
      router.quoteSignals(lines);
      router.settleQuote();
      router.clearQuote();

      expect(stream.quoteUser).toHaveBeenCalledWith(quote);
      expect(stream.quoteSignals).toHaveBeenCalledWith(lines);
      expect(stream.settleQuote).toHaveBeenCalledOnce();
      expect(stream.clearQuote).toHaveBeenCalledOnce();
      expect(local.quoteUser).not.toHaveBeenCalled();
    });

    it("summons the unified composer, reports it open and shows its errors there", () => {
      setShown(true);

      router.summonInput();
      router.showInputError("Could not reach the backend");
      router.dismissInput();
      router.restoreInput("hi", []);

      expect(stream.summonInput).toHaveBeenCalledOnce();
      expect(router.isInputOpen()).toBe(true);
      expect(stream.showInputError).toHaveBeenCalledWith("Could not reach the backend", undefined);
      for (const side of [local, remote, stream]) {
        expect(side.dismissInput).not.toHaveBeenCalled();
        expect(side.restoreInput).not.toHaveBeenCalled();
      }
      expect(local.summonInput).not.toHaveBeenCalled();
    });

    it("hides both bubbles and closes the open input when it starts showing", () => {
      vi.mocked(local.isInputOpen).mockReturnValue(true);

      setShown(true);

      expect(local.hideSpeech).toHaveBeenCalledOnce();
      expect(remote.hideSpeech).toHaveBeenCalledOnce();
      expect(local.dismissInput).toHaveBeenCalledOnce();
      expect(remote.dismissInput).not.toHaveBeenCalled();
    });

    it("drops the rest of a line begun on the character's bubble once it starts showing", () => {
      router.beginSpeech(identity);
      router.pushSpeech("hello ", identity);

      setShown(true);
      router.pushSpeech("world", identity);
      router.paceSpeech({ text: "world", durationMs: 300 });
      router.endSpeech({ defer: true }, identity);

      expect(local.pushSpeech.mock.calls).toEqual([["hello ", identity]]);
      expect(local.endSpeech).not.toHaveBeenCalled();
      for (const name of ["pushSpeech", "paceSpeech", "endSpeech"] as const)
        expect(stream[name]).not.toHaveBeenCalled();
    });

    it("keeps a line begun on the stream there until its end once it stops showing", () => {
      setShown(true);
      router.beginSpeech(identity);
      router.pushSpeech("hello ", identity);

      setShown(false);
      router.pushSpeech("world", identity);
      router.endSpeech({ defer: true }, identity);
      router.finishSpeech();

      expect(stream.pushSpeech.mock.calls).toEqual([
        ["hello ", identity],
        ["world", identity],
      ]);
      expect(stream.endSpeech).toHaveBeenCalledWith({ defer: true }, identity);
      expect(stream.finishSpeech).toHaveBeenCalledOnce();
      expect(local.pushSpeech).not.toHaveBeenCalled();
    });
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
      stream: makeRemote(),
      getMode: () => mode,
      subscribeMode: (cb) => {
        listeners.push(cb);
        return () => {};
      },
      shown: { get: () => false, subscribe: () => () => {} },
    });
    disposers.push(router.dispose, petBridge.dispose, messageBridge.dispose);

    const setMode = (next: MessageWindowMode): void => {
      mode = next;
      for (const cb of listeners) cb(next);
    };

    /** The message window's surfaces and plate, wired to the bridge as its bootstrap does. */
    const mountMessageWindow = () => {
      const surfaces = createSurfaces({ tool: noTool, mount: document.createElement("div") });
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

    return { router, setMode, mountMessageWindow, messageBridge };
  }

  it("carries a paced line and its sentence starts to the message window while popped", () => {
    const { router, messageBridge } = setup("popped");
    const ops = vi.fn();
    messageBridge.onSurface(ops);

    router.beginSpeech(undefined, { paced: true });
    router.paceSpeech({ text: "Hi.", durationMs: 500 });

    expect(ops.mock.calls).toEqual([
      [{ op: "begin", paced: true }],
      [{ op: "pace", text: "Hi.", durationMs: 500 }],
    ]);
  });

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
