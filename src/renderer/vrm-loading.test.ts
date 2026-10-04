import type { VRM } from "@pixiv/three-vrm";
import { describe, expect, it } from "vitest";
import { readVrmMetaName } from "./vrm-loading";

const withMeta = (meta: unknown) => ({ meta }) as unknown as VRM;

describe("readVrmMetaName", () => {
  it("reads VRM1.0 meta.name, trimmed", () => {
    expect(readVrmMetaName(withMeta({ name: "  Yui " }))).toBe("Yui");
  });

  it("falls back to VRM0.0 meta.title", () => {
    expect(readVrmMetaName(withMeta({ title: "Old" }))).toBe("Old");
  });

  it("returns null when neither is a non-empty string", () => {
    expect(readVrmMetaName(withMeta({ name: "   " }))).toBeNull();
    expect(readVrmMetaName(withMeta(undefined))).toBeNull();
  });
});
