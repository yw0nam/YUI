import { describe, expect, it } from "vitest";
import { createUserNameSettings } from "./user-name-settings";

describe("createUserNameSettings", () => {
  it("trims the name, caps it at 64 characters, and persists it", () => {
    let saved: { name: string } | null = null;
    const storage = { load: () => saved, save: (v: { name: string }) => (saved = v) };
    const store = createUserNameSettings({ storage });
    store.setName(`  ${"n".repeat(70)}  `);
    expect(createUserNameSettings({ storage }).get()).toEqual({ name: "n".repeat(64) });
  });
});
