// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../../../settings/backend/agent-notify-settings";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { createThreadReactionThresholdsSettings } from "../../../../settings/threads/thread-reaction-thresholds-settings";
import { createThreadTurnsSettings } from "../../../../settings/threads/thread-turns-settings";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import {
  countSubscriptions,
  defaultQcArgs,
  makeSpeakerSelection,
  makeVrmSelection,
} from "../../test-helpers";

describe("createQuickControls — reactions section", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      vrmSelection: makeVrmSelection(),
      speakerSelection: makeSpeakerSelection(),
      ...extra,
    });
  }

  it.each([
    null,
    "abc12345",
  ])("shows this window's ingress URL (%s) and updates the stored port", (boundId) => {
    const agentNotifySettings = createAgentNotifySettings();
    const qc = buildQc({ agentNotifySettings, boundId });
    qc.open();
    const suffix = boundId ? `/presets/${boundId}/signals` : "/signals";
    expect(qc.el.querySelector("#yui-ingress-url")?.textContent).toBe(
      `http://127.0.0.1:8770${suffix}`,
    );
    agentNotifySettings.setPort(9100);
    expect(qc.el.querySelector("#yui-ingress-url")?.textContent).toBe(
      `http://127.0.0.1:9100${suffix}`,
    );
    qc.dispose();
  });

  it("renders #yui-agent-port that reflects agentNotifySettings.port on open", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port");
    expect(portInput).not.toBeNull();
    // Default port = 8770
    expect(portInput!.value).toBe("8770");
    qc.dispose();
  });

  it("external agentNotifySettings.setPort reflects into #yui-agent-port while open", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    agentNotifySettings.setPort(9100);
    expect(qc.el.querySelector<HTMLInputElement>("#yui-agent-port")!.value).toBe("9100");
    qc.dispose();
  });

  it("change on #yui-agent-port calls agentNotifySettings.setPort", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const setSpy = vi.spyOn(agentNotifySettings, "setPort");
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port")!;
    portInput.value = "9000";
    portInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(9000);
    qc.dispose();
  });

  // ── Snap-back regression tests ────────────────────────────────────────────
  // When the store setter silently rejects an out-of-range value (no-op),
  // the change handler's explicit reflect.*() must snap the input back to the
  // current stored value so the field never shows an uncommitted state.

  it("below-range value in #yui-agent-port snaps back: store unchanged, input reverts to 8770", () => {
    const agentNotifySettings = createAgentNotifySettings(); // default port = 8770
    const setSpy = vi.spyOn(agentNotifySettings, "setPort");
    const qc = buildQc({ agentNotifySettings });
    qc.open();
    const portInput = qc.el.querySelector<HTMLInputElement>("#yui-agent-port")!;
    portInput.value = "80"; // below the 1024 minimum
    portInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(80); // setter was invoked but rejected
    expect(agentNotifySettings.get().port).toBe(8770); // store unchanged
    expect(portInput.value).toBe("8770"); // input snapped back
    qc.dispose();
  });

  it("sets the Thread turns level from its segment, disabled with a reason while External signals is off", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const threadTurnsSettings = createThreadTurnsSettings();
    const qc = buildQc({ agentNotifySettings, threadTurnsSettings });
    const cells = [
      ...qc.el.querySelectorAll<HTMLButtonElement>(".yui-threadturns-seg [data-level]"),
    ];
    const reason = qc.el.querySelector<HTMLElement>(".yui-threadturns-reason")!;
    qc.open();
    expect(cells.map((c) => c.dataset.level)).toEqual(["off", "notable", "every"]);
    expect(cells.map((c) => c.disabled)).toEqual([true, true, true]);
    expect(reason.hidden).toBe(false);
    expect(reason.textContent).toBe("Turn on External signals to use this.");

    agentNotifySettings.setEnabled(true);
    expect(cells.map((c) => c.disabled)).toEqual([false, false, false]);
    expect(reason.hidden).toBe(true);

    cells[1].click();
    expect(threadTurnsSettings.get()).toEqual({ level: "notable" });
    expect(cells.map((c) => c.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    qc.dispose();
  });

  it("sets the Reaction thresholds count from its segment, also while Thread reactions is off", () => {
    const threadReactionsSettings = createFlagSettings(false);
    const threadReactionThresholdsSettings = createThreadReactionThresholdsSettings();
    const qc = buildQc({ threadReactionsSettings, threadReactionThresholdsSettings });
    const countCells = [
      ...qc.el.querySelectorAll<HTMLButtonElement>(
        ".yui-reaction-thresholds-count-seg [data-count]",
      ),
    ];
    qc.open();
    expect(countCells.map((c) => c.dataset.count)).toEqual(["0", "2", "3", "5"]);

    countCells[3].click();

    expect(threadReactionThresholdsSettings.get()).toEqual({ count: 5, wait_min: 10 });
    expect(countCells.map((c) => c.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    qc.dispose();
  });

  it("releases every agent-port and thread-turns subscription on dispose", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const threadTurnsSettings = createThreadTurnsSettings();
    const counts = [agentNotifySettings, threadTurnsSettings].map(countSubscriptions);
    const qc = buildQc({ agentNotifySettings, threadTurnsSettings });

    qc.dispose();

    for (const { taken, released } of counts) {
      expect(taken).toBeGreaterThan(0);
      expect(released).toBe(taken);
    }
  });
});
