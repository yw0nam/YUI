import { describe, expect, it } from "vitest";
import { composeResponsesInput } from "./request-input";

const USER = [{ role: "user", content: "hi" }];
const PENDING = [{ type: "function_call_output" as const, call_id: "call_1", output: "ok" }];

describe("composeResponsesInput", () => {
  it("continuing a chain: pending outputs, post-history, user; no greeting", () => {
    expect(
      composeResponsesInput({
        userItems: USER,
        pendingOutputs: PENDING,
        postHistory: "stay brief",
        greetingReplay: ["Hello."],
        freshChain: false,
      }),
    ).toEqual([...PENDING, { role: "system", content: "stay brief" }, ...USER]);
  });

  it("a fresh chain: greeting, post-history, user", () => {
    expect(
      composeResponsesInput({
        userItems: USER,
        pendingOutputs: [],
        postHistory: "stay brief",
        greetingReplay: ["Hello."],
        freshChain: true,
      }),
    ).toEqual([
      { role: "assistant", content: "Hello." },
      { role: "system", content: "stay brief" },
      ...USER,
    ]);
  });
});
