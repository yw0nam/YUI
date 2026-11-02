import { describe, expect, it, vi } from "vitest";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { createVoiceFix } from "./voice-fix";

describe("createVoiceFix", () => {
  it("opens the setup page, then hands the pill back to listening", () => {
    const status = createVoiceInputStatus();
    status.set("error", "not_configured");
    const calls: string[] = [];
    const openSetup = vi.fn(() => calls.push(`open:${status.get().state}`));

    createVoiceFix({ openSetup, status })();

    expect(openSetup).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["open:error"]);
    expect(status.get().state).toBe("listening");
  });
});
