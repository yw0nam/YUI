import { describe, expect, it, vi } from "vitest";
import { type BridgeTransport, createSettingsBridge } from "../../io/bridge/settings-bridge";
import { wireHelpGuide } from "./wire-help-guide";

/** In-memory pub/sub shared by two bridges — one per window. */
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
      return () => set?.delete(cb);
    },
  };
}

function setup() {
  const transport = createFakeTransport();
  const petBridge = createSettingsBridge(transport, { windowKind: "pet" });
  const settingsBridge = createSettingsBridge(transport, { windowKind: "settings" });
  const userInput = { submitGuide: vi.fn() };
  const disposers: Array<() => void> = [];
  const ask = wireHelpGuide({
    userInput,
    bridge: petBridge,
    register: (fn) => disposers.push(fn),
  });
  return { settingsBridge, userInput, disposers, ask };
}

describe("wireHelpGuide", () => {
  it("a press in the settings window reaches the pet window and submits there with the text it sent", () => {
    const { settingsBridge, userInput } = setup();

    settingsBridge.emitHelpGuide({ guide: "capabilities", text: "YUIで何ができるか教えて" });

    expect(userInput.submitGuide).toHaveBeenCalledExactlyOnceWith(
      "capabilities",
      "YUIで何ができるか教えて",
    );
  });

  it("a payload with an unknown guide or a non-string text is ignored", () => {
    const { settingsBridge, userInput } = setup();

    settingsBridge.emitHelpGuide({ guide: "nope", text: "hi" } as never);
    settingsBridge.emitHelpGuide({ guide: "controls", text: 1 } as never);

    expect(userInput.submitGuide).not.toHaveBeenCalled();
  });

  it("a press in the pet window submits directly, and the registered teardown detaches the listener", () => {
    const { settingsBridge, userInput, disposers, ask } = setup();

    ask("controls", "How do I control YUI?");
    expect(userInput.submitGuide).toHaveBeenCalledWith("controls", "How do I control YUI?");

    for (const dispose of disposers) dispose();
    settingsBridge.emitHelpGuide({ guide: "controls", text: "late" });
    expect(userInput.submitGuide).toHaveBeenCalledTimes(1);
  });
});
