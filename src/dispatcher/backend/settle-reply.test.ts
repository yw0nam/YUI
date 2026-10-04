import { describe, expect, it, vi } from "vitest";
import type { ControlEnvelope } from "../../contract";
import type { Logger } from "../../logger";
import type { TurnOutput } from "../turn/turn-output";
import { createReplySettler, type SettleDeps } from "./settle-reply";

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// Narrow cast: the settle step reads only cue, end and speak.
function outputOf(members: Pick<TurnOutput, "cue" | "end" | "speak">): TurnOutput {
  return members as TurnOutput;
}

function makeOutput(calls: string[]): TurnOutput {
  return outputOf({
    cue: () => calls.push("cue"),
    end: () => calls.push("end"),
    speak: () => calls.push("speak"),
  });
}

describe("createReplySettler", () => {
  it("runs render, cue, speak, reportSpokeText in order and returns the reported value", () => {
    const calls: string[] = [];
    const deps: SettleDeps = {
      renderer: { applyDirective: () => calls.push("render") },
      turnOutput: makeOutput(calls),
      reportSpokeText: (spoke) => calls.push(`report:${spoke}`),
    };
    const envelope: ControlEnvelope = {
      emotion: { id: "happy" },
      emotion_text: "warm",
      speech_text: "hello",
    };
    const spoke = createReplySettler(deps, makeLog()).settle({
      envelope,
      streamedAny: false,
      cueStreamed: false,
      getEventName: () => "user.text",
    });
    expect(calls).toEqual(["render", "cue", "speak", "report:true"]);
    expect(spoke).toBe(true);
  });

  it("catches a renderer throw and keeps settling, but lets a throw outside the try propagate", () => {
    const calls: string[] = [];
    const log = makeLog();
    const envelope: ControlEnvelope = {
      emotion: { id: "happy" },
      speech_text: "hi",
    };
    const deps: SettleDeps = {
      renderer: {
        applyDirective: () => {
          throw new Error("boom");
        },
      },
      turnOutput: makeOutput(calls),
      reportSpokeText: (spoke) => calls.push(`report:${spoke}`),
    };
    const args = { envelope, streamedAny: false, cueStreamed: false, getEventName: () => "e" };
    expect(createReplySettler(deps, log).settle(args)).toBe(true);
    expect(log.error).toHaveBeenCalledWith("dispatch_to_renderer.error", {
      error: "Error: boom",
    });
    expect(calls).toEqual(["speak", "report:true"]);

    const failing: SettleDeps = {
      renderer: { applyDirective: () => {} },
      turnOutput: outputOf({
        cue: () => {},
        end: () => {},
        speak: () => {
          throw new Error("speak failed");
        },
      }),
      reportSpokeText: (spoke) => calls.push(`late:${spoke}`),
    };
    expect(() => createReplySettler(failing, makeLog()).settle(args)).toThrow("speak failed");
    expect(calls).not.toContain("late:true");
  });

  it("reads deps members and the event name at the point of use", () => {
    const first: string[] = [];
    const second: string[] = [];
    let eventName = "before";
    const deps: SettleDeps = {
      renderer: {
        applyDirective: () => {
          deps.turnOutput = makeOutput(second);
          deps.reportSpokeText = (spoke) => second.push(`report:${spoke}`);
          eventName = "after";
        },
      },
      turnOutput: makeOutput(first),
      reportSpokeText: (spoke) => first.push(`report:${spoke}`),
    };
    const log = makeLog();
    const envelope: ControlEnvelope = {
      emotion: { id: "happy" },
      emotion_text: "warm",
      speech_text: "",
    };
    createReplySettler(deps, log).settle({
      envelope,
      streamedAny: false,
      cueStreamed: false,
      getEventName: () => eventName,
    });
    expect(first).toEqual([]);
    expect(second).toEqual(["cue", "report:false"]);
    expect(log.info).toHaveBeenCalledWith("empty_speech", { trigger: "after" });
  });
});
