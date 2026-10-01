import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

describe("Vite development configuration", () => {
  it("does not watch Rust or Android build output", async () => {
    const config =
      typeof viteConfig === "function"
        ? await viteConfig({ command: "serve", mode: "development" })
        : viteConfig;

    const ignored = config.server?.watch?.ignored;

    expect(ignored).toEqual(
      expect.arrayContaining(["**/src-tauri/target/**", "**/src-tauri/gen/**"]),
    );
  });
});
