/**
 * tts-provider.test.ts — the shared TtsProvider selection helpers.
 *
 * resolveTtsProviderKind/isTtsProviderKind/emotionTextModeFor/selectProvider are pure and have
 * no network or DOM dependency — this pins the "unset means irodori" default and the
 * enum/free emotion_text split (docs/reference/tts-emotion) as the single source both the
 * validator's default and the UI's pre-load fallback defer to.
 */

import { describe, expect, it, vi } from "vitest";
import {
  emotionTextModeFor,
  isTtsProviderKind,
  resolveTtsProviderKind,
  selectProvider,
  type TtsProvider,
} from "./tts-provider";

function fakeProvider(): TtsProvider {
  return {
    synth: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
    paramsKey: vi.fn(() => "key"),
    isReady: vi.fn(() => true),
    emotionTextMode: vi.fn(() => "free"),
  };
}

describe("resolveTtsProviderKind", () => {
  it("resolves undefined to irodori", () => {
    expect(resolveTtsProviderKind(undefined)).toBe("irodori");
  });

  it("resolves openai to openai", () => {
    expect(resolveTtsProviderKind("openai")).toBe("openai");
  });

  it("resolves irodori to irodori", () => {
    expect(resolveTtsProviderKind("irodori")).toBe("irodori");
  });

  it("resolves any other value to irodori", () => {
    expect(resolveTtsProviderKind("bogus")).toBe("irodori");
  });
});

describe("isTtsProviderKind", () => {
  it("accepts irodori and openai", () => {
    expect(isTtsProviderKind("irodori")).toBe(true);
    expect(isTtsProviderKind("openai")).toBe(true);
  });

  it("rejects undefined and anything else", () => {
    expect(isTtsProviderKind(undefined)).toBe(false);
    expect(isTtsProviderKind("")).toBe(false);
    expect(isTtsProviderKind("bogus")).toBe(false);
  });
});

describe("emotionTextModeFor", () => {
  it("irodori is enum", () => {
    expect(emotionTextModeFor("irodori")).toBe("enum");
  });

  it("openai is free", () => {
    expect(emotionTextModeFor("openai")).toBe("free");
  });
});

describe("selectProvider", () => {
  it("selects the irodori provider when tts_provider is irodori", () => {
    const irodori = fakeProvider();
    const openai = fakeProvider();
    expect(selectProvider({ tts_provider: "irodori" }, { irodori, openai })).toBe(irodori);
  });

  it("selects the openai provider when tts_provider is openai", () => {
    const irodori = fakeProvider();
    const openai = fakeProvider();
    expect(selectProvider({ tts_provider: "openai" }, { irodori, openai })).toBe(openai);
  });

  it("selects the irodori provider when tts_provider is unset (default)", () => {
    const irodori = fakeProvider();
    const openai = fakeProvider();
    expect(selectProvider({}, { irodori, openai })).toBe(irodori);
  });
});
