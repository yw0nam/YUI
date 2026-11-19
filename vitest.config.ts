import { defineConfig } from "vitest/config";

// node by default; DOM tests opt in per file with // @vitest-environment jsdom.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts", "docs/landing/**/*.test.ts"],
    mockReset: true,
  },
});
