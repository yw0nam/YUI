// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../../../settings/backend/agent-notify-settings";
import { createGuardrailsSettings } from "../../../../settings/backend/guardrails-settings";
import { createPacerGapStore, createPresenceStore } from "../../../../settings/settings-stores";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import {
  countSubscriptions,
  defaultQcArgs,
  makeSpeakerSelection,
  makeVrmSelection,
} from "../../test-helpers";

const inMemoryValueStorage = () => {
  let value: { value: number } | null = null;
  return {
    load: () => value,
    save: (next: { value: number }) => {
      value = next;
    },
  };
};

const inMemoryPresenceStore = () => createPresenceStore(inMemoryValueStorage());

const inMemoryPacerGapStore = () => createPacerGapStore(inMemoryValueStorage());

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

  it("does not render #yui-presence when presenceSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector("#yui-presence")).toBeNull();
    qc.dispose();
  });

  it("#yui-presence reflects presenceSettings.value/1000 on open", () => {
    const presenceSettings = inMemoryPresenceStore();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    // Default value = 180000 ms → 180 s
    expect(presenceInput.value).toBe("180");
    qc.dispose();
  });

  it("change on #yui-presence calls presenceSettings.set(s * 1000)", () => {
    const presenceSettings = inMemoryPresenceStore();
    const setSpy = vi.spyOn(presenceSettings, "set");
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceInput.value = "300";
    presenceInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(300000);
    qc.dispose();
  });

  it("external presenceSettings.set reflects into #yui-presence while open", () => {
    const presenceSettings = inMemoryPresenceStore();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceSettings.set(60000);
    expect(presenceInput.value).toBe("60");
    qc.dispose();
  });

  it("commits a focused presence edit before resyncing on blur", () => {
    const presenceSettings = inMemoryPresenceStore();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;

    presenceInput.focus();
    presenceInput.value = "300";
    presenceSettings.set(60000);

    expect(presenceInput.value).toBe("300");

    presenceInput.dispatchEvent(new Event("change"));
    presenceInput.blur();
    expect(presenceSettings.get().value).toBe(300000);
    expect(presenceInput.value).toBe("300");
    qc.dispose();
  });

  it("resyncs an unedited focused presence field without reverting a remote change", () => {
    const presenceSettings = inMemoryPresenceStore();
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;

    presenceInput.focus();
    presenceSettings.set(60000);

    expect(presenceInput.value).toBe("180");

    presenceInput.blur();
    expect(presenceSettings.get().value).toBe(60000);
    expect(presenceInput.value).toBe("60");
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

  it("below-floor value in #yui-presence snaps back: store unchanged, input reverts to 180", () => {
    const presenceSettings = inMemoryPresenceStore();
    const setSpy = vi.spyOn(presenceSettings, "set");
    const qc = buildQc({ presenceSettings });
    qc.open();
    const presenceInput = qc.el.querySelector<HTMLInputElement>("#yui-presence")!;
    presenceInput.value = "5"; // 5 s → 5000 ms — below the 10 000 ms floor
    presenceInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith(5000); // setter was invoked but rejected
    expect(presenceSettings.get().value).toBe(180000); // store unchanged
    expect(presenceInput.value).toBe("180"); // input snapped back
    qc.dispose();
  });

  // ── Proactive gap (global pacer) ───────────────────────────────────────────

  it("does not render #yui-pacer-gap when pacerGapSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector("#yui-pacer-gap")).toBeNull();
    qc.dispose();
  });

  it("#yui-pacer-gap reflects the stored gap in minutes on open", () => {
    const pacerGapSettings = inMemoryPacerGapStore();
    const qc = buildQc({ pacerGapSettings });
    qc.open();
    // Default value = 600000 ms → 10 min
    expect(qc.el.querySelector<HTMLInputElement>("#yui-pacer-gap")!.value).toBe("10");
    qc.dispose();
  });

  it("change on #yui-pacer-gap commits minutes * 60000", () => {
    const pacerGapSettings = inMemoryPacerGapStore();
    const qc = buildQc({ pacerGapSettings });
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-pacer-gap")!;
    input.value = "25";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pacerGapSettings.get().value).toBe(1_500_000);
    qc.dispose();
  });

  // 0 is the off position, not a rejected value — the pacer holds nothing at that setting.
  it("commits 0 from #yui-pacer-gap, turning the pacer off", () => {
    const pacerGapSettings = inMemoryPacerGapStore();
    const qc = buildQc({ pacerGapSettings });
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-pacer-gap")!;
    input.value = "0";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pacerGapSettings.get().value).toBe(0);
    expect(input.value).toBe("0");
    qc.dispose();
  });

  it("does not commit #yui-pacer-gap on every keystroke", () => {
    const pacerGapSettings = inMemoryPacerGapStore();
    const setSpy = vi.spyOn(pacerGapSettings, "set");
    const qc = buildQc({ pacerGapSettings });
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-pacer-gap")!;
    input.focus();
    for (const partial of ["2", "25"]) {
      input.value = partial;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(setSpy).not.toHaveBeenCalled();

    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pacerGapSettings.get().value).toBe(1_500_000);
    qc.dispose();
  });

  it("external pacerGapSettings.set reflects into #yui-pacer-gap while open", () => {
    const pacerGapSettings = inMemoryPacerGapStore();
    const qc = buildQc({ pacerGapSettings });
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-pacer-gap")!;
    pacerGapSettings.set(1_800_000);
    expect(input.value).toBe("30");
    qc.dispose();
  });

  it("detaches the #yui-pacer-gap listeners on dispose", () => {
    const pacerGapSettings = inMemoryPacerGapStore();
    const qc = buildQc({ pacerGapSettings });
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-pacer-gap")!;
    qc.dispose();

    input.value = "25";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pacerGapSettings.get().value).toBe(600_000);
  });

  // ── Rate-limit caps ───────────────────────────────────────────────────────

  const RATE_LIMIT_DEFAULTS = { tier2_max: 24, overall_max: 40 };

  function buildRateQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    const rateLimitSettings = createGuardrailsSettings();
    return {
      rateLimitSettings,
      qc: buildQc({
        rateLimitSettings,
        getRateLimitDefaults: () => RATE_LIMIT_DEFAULTS,
        ...extra,
      }),
    };
  }

  it("does not render the rate-limit rows when rateLimitSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector("#yui-rate-tier2")).toBeNull();
    expect(qc.el.querySelector("#yui-rate-overall")).toBeNull();
    qc.dispose();
  });

  it("shows the config defaults while no cap is overridden", () => {
    const { qc } = buildRateQc();
    qc.open();
    expect(qc.el.querySelector<HTMLInputElement>("#yui-rate-tier2")!.value).toBe("24");
    expect(qc.el.querySelector<HTMLInputElement>("#yui-rate-overall")!.value).toBe("40");
    qc.dispose();
  });

  it("shows the stored cap instead of the config default", () => {
    const { rateLimitSettings, qc } = buildRateQc();
    rateLimitSettings.set({ tier2_max: 30 });
    qc.open();
    expect(qc.el.querySelector<HTMLInputElement>("#yui-rate-tier2")!.value).toBe("30");
    expect(qc.el.querySelector<HTMLInputElement>("#yui-rate-overall")!.value).toBe("40");
    qc.dispose();
  });

  it("commits a cap on change", () => {
    const { rateLimitSettings, qc } = buildRateQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-rate-overall")!;
    input.value = "60";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rateLimitSettings.get().overall_max).toBe(60);
    qc.dispose();
  });

  it("does not commit on every keystroke", () => {
    const { rateLimitSettings, qc } = buildRateQc();
    const setSpy = vi.spyOn(rateLimitSettings, "set");
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-rate-tier2")!;
    input.focus();
    for (const partial of ["3", "30"]) {
      input.value = partial;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(setSpy).not.toHaveBeenCalled();
    expect(rateLimitSettings.get().tier2_max).toBe(0);

    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rateLimitSettings.get().tier2_max).toBe(30);
    qc.dispose();
  });

  it("clears the override when the field is emptied", () => {
    const { rateLimitSettings, qc } = buildRateQc();
    rateLimitSettings.set({ tier2_max: 30 });
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-rate-tier2")!;
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rateLimitSettings.get().tier2_max).toBe(0);
    expect(input.value).toBe("24");
    qc.dispose();
  });

  it("reflects an external cap edit while open", () => {
    const { rateLimitSettings, qc } = buildRateQc();
    qc.open();
    rateLimitSettings.set({ overall_max: 60 });
    expect(qc.el.querySelector<HTMLInputElement>("#yui-rate-overall")!.value).toBe("60");
    qc.dispose();
  });

  it("keeps an existing cap when an out-of-range value is entered", () => {
    const { rateLimitSettings, qc } = buildRateQc();
    rateLimitSettings.set({ tier2_max: 30 });
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-rate-tier2")!;
    input.value = "1000";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rateLimitSettings.get().tier2_max).toBe(30); // store unchanged
    expect(input.value).toBe("30"); // input snapped back
    qc.dispose();
  });

  it("snaps back to the config default when an out-of-range value is entered with no override", () => {
    const { rateLimitSettings, qc } = buildRateQc();
    qc.open();
    const input = qc.el.querySelector<HTMLInputElement>("#yui-rate-tier2")!;
    input.value = "-5";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rateLimitSettings.get().tier2_max).toBe(0);
    expect(input.value).toBe("24");
    qc.dispose();
  });

  it("releases every agent-port, presence, pacer-gap and cap subscription on dispose", () => {
    const agentNotifySettings = createAgentNotifySettings();
    const presenceSettings = inMemoryPresenceStore();
    const pacerGapSettings = inMemoryPacerGapStore();
    const rateLimitSettings = createGuardrailsSettings();
    const counts = [agentNotifySettings, presenceSettings, pacerGapSettings, rateLimitSettings].map(
      countSubscriptions,
    );
    const qc = buildQc({
      agentNotifySettings,
      presenceSettings,
      pacerGapSettings,
      rateLimitSettings,
    });

    qc.dispose();

    for (const { taken, released } of counts) {
      expect(taken).toBeGreaterThan(0);
      expect(released).toBe(taken);
    }
  });
});
