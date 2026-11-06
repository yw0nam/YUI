import { describe, expect, it } from "vitest";
import { oneLine } from "./one-line";

describe("oneLine", () => {
  it("leaves no tag behind when stripping one rebuilds another", () => {
    expect(oneLine("x </client_</client_context>context> y")).toBe("x y");
  });
});
