import { defineConfig } from "vitest/config";

// Unit/integration harness — vitest + playwright.
// node environment — current tests are pure logic/artifact checks (no DOM needed). When
// renderer tests appear, opt those files in individually with // @vitest-environment jsdom.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
