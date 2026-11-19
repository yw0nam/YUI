import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";

// unit: node by default; DOM tests opt in per file with // @vitest-environment jsdom.
// vrt: screenshot tests (*.vrt.test.ts) in real WebKit; `pnpm test:vrt`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts", "docs/landing/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "src/**/*.vrt.test.ts"],
          mockReset: true,
        },
      },
      {
        test: {
          name: "vrt",
          include: ["src/**/*.vrt.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "webkit" }],
            expect: {
              toMatchScreenshot: { comparatorOptions: { allowedMismatchedPixelRatio: 0.01 } },
            },
          },
        },
      },
    ],
  },
});
