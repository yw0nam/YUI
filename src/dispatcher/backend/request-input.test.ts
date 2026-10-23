import { describe, expect, it } from "vitest";
import { composeResponsesInput } from "./request-input";

const USER = [{ role: "user", content: "hi" }];
const PENDING = [{ type: "function_call_output" as const, call_id: "call_1", output: "ok" }];

describe("composeResponsesInput", () => {
  it("continuing a chain: pending outputs, then user; no greeting", () => {
    expect(
      composeResponsesInput({
        userItems: USER,
        pendingOutputs: PENDING,
        greetingReplay: ["Hello."],
        freshChain: false,
      }),
    ).toEqual([...PENDING, ...USER]);
  });

  it("a fresh chain: greeting, then user", () => {
    expect(
      composeResponsesInput({
        userItems: USER,
        pendingOutputs: [],
        greetingReplay: ["Hello."],
        freshChain: true,
      }),
    ).toEqual([{ role: "assistant", content: "Hello." }, ...USER]);
  });
});
