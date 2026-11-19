import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// node by default; DOM tests opt in per file with // @vitest-environment jsdom.
// `environment` stays unset: the Solid plugin compiles for the server when it reads `node` here.
export default defineConfig({
  plugins: [solid()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts", "docs/landing/**/*.test.ts"],
    mockReset: true,
  },
});
