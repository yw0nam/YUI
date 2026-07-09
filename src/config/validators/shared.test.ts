import { describe, expect, it } from "vitest";
import { assertValid, ConfigError, isObject } from "./shared";

describe("ConfigError", () => {
  it("joins issues into the message and exposes file/issues", () => {
    const err = new ConfigError("motions.json", ["a: bad", "b: bad"]);
    expect(err.message).toBe("[config] motions.json: a: bad; b: bad");
    expect(err.name).toBe("ConfigError");
    expect(err.file).toBe("motions.json");
    expect(err.issues).toEqual(["a: bad", "b: bad"]);
  });

  it("is a real Error instance", () => {
    const err = new ConfigError("f.json", ["x"]);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("isObject", () => {
  it("accepts plain objects", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it("rejects arrays", () => {
    expect(isObject([])).toBe(false);
    expect(isObject([1, 2])).toBe(false);
  });

  it("rejects null", () => {
    expect(isObject(null)).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isObject("x")).toBe(false);
    expect(isObject(1)).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

describe("assertValid", () => {
  it("does nothing when issues is empty", () => {
    expect(() => assertValid("f.json", [])).not.toThrow();
  });

  it("throws ConfigError carrying file + issues when issues is non-empty", () => {
    try {
      assertValid("f.json", ["broken"]);
      expect.unreachable("assertValid should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).file).toBe("f.json");
      expect((e as ConfigError).issues).toEqual(["broken"]);
    }
  });
});
