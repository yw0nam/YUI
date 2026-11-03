import { describe, expect, it, vi } from "vitest";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { createVoiceFix } from "./voice-fix";

describe("createVoiceFix", () => {
  it("opens the connection settings, then hands the pill back to listening", () => {
    const status = createVoiceInputStatus();
    status.set("error", "not_configured");
    const calls: string[] = [];
    const openConnection = vi.fn(() => calls.push(`open:${status.get().state}`));

    createVoiceFix({ openConnection, status })();

    expect(openConnection).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["open:error"]);
    expect(status.get().state).toBe("listening");
  });
});
