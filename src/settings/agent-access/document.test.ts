/**
 * document.test.ts — the settings document an agent reads and patches.
 *
 * Pins the exposed path set, a direct write, validation through each store's own parse, the allow
 * tier that waits for the user, and the merge of a partial nested patch.
 */

import { describe, expect, it } from "vitest";
import { createSettingsStores } from "../settings-stores";
import { applyPatch, readDocument } from "./document";

const EXPOSED_PATHS = [
  "appearance.text_size",
  "appearance.theme",
  "body.climb",
  "body.fall",
  "body.gaze",
  "body.mouth_gain",
  "bubble.keep",
  "character.active_hours",
  "character.reasoning_effort",
  "limits.addressed_chain_max",
  "limits.proactive_gap_ms",
  "limits.tier2_max",
  "limits.urgent_max",
  "pace.base",
  "pace.rest",
  "performance.idle_throttle",
  "privacy.external_signals",
  "privacy.screen_display",
  "privacy.screen_requests",
  "privacy.screen_watch.enabled",
  "privacy.screen_watch.long_session_ms",
  "privacy.screen_watch.prev_dwell_ms",
  "privacy.screen_watch.recent_cap",
  "privacy.screen_watch.settle_ms",
  "privacy.screenshot",
  "privacy.thread_turns",
  "relations.enabled",
  "threads.reaction_count",
  "threads.reaction_wait_min",
  "threads.reactions",
  "unified_chat",
  "user.name",
  "voice.filler.enabled",
  "voice.filler.language",
  "voice.one_at_a_time",
  "voice.output",
  "voice.readings",
  "voice_input.barge_in",
  "voice_input.silence_ms",
];

function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("readDocument", () => {
  it("holds exactly the exposed paths", () => {
    const paths = leafPaths(readDocument(createSettingsStores())).sort();

    expect(paths).toEqual(EXPOSED_PATHS);
    expect(paths).not.toContain("endpoints.chat");
    expect(paths).not.toContain("card");
    expect(paths).not.toContain("presence");
    expect(paths).not.toContain("proactive");
  });

  it("keeps the motion-id lists unexposed", () => {
    expect(readDocument(createSettingsStores()).motions).toBeUndefined();
  });
});

describe("applyPatch", () => {
  it("writes a direct setting and answers ok", () => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, { bubble: { keep: true } });

    expect(result.direct).toEqual({ "bubble.keep": "ok" });
    expect(result.allow).toEqual([]);
    expect(stores.bubblePersistSettings.get()).toEqual({ enabled: true });
  });

  it("rejects a theme outside the list and leaves the store", () => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, { appearance: { theme: "neon" } });

    expect(result.direct).toEqual({ "appearance.theme": "error: invalid appearance.theme" });
    expect(stores.themeSettings.get()).toEqual({ theme: "system" });
  });

  it("rejects a number a store would clamp", () => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, { voice_input: { silence_ms: 100 } });

    expect(result.direct).toEqual({
      "voice_input.silence_ms": "error: invalid voice_input.silence_ms",
    });
    expect(stores.vadSettings.get().silenceMs).toBe(1500);
  });

  it("answers an unknown path with an error", () => {
    const result = applyPatch(createSettingsStores(), { endpoints: { chat: "https://example" } });

    expect(result.direct).toEqual({ "endpoints.chat": "error: unknown endpoints.chat" });
  });

  it("returns an allow setting without writing it", () => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, { privacy: { screenshot: true } });

    expect(result.allow).toEqual([
      { path: "privacy.screenshot", labelKey: "screenshot.label", from: false, to: true },
    ]);
    expect(result.direct).toEqual({});
    expect(stores.screenshotSettings.get().enabled).toBe(false);
  });

  it("clears the active hours when their value is null", () => {
    const stores = createSettingsStores();
    stores.activeHoursSettings.setSpans([{ start: "09:00", end: "17:00", pace: "high" }]);

    const result = applyPatch(stores, { character: { active_hours: null } });

    expect(result.direct).toEqual({ "character.active_hours": "ok" });
    expect(stores.activeHoursSettings.get()).toEqual({ spans: null });
  });

  it("keeps the sibling field on a nested patch", () => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, { privacy: { screen_watch: { recent_cap: 10 } } });

    expect(result.direct).toEqual({});
    expect(result.allow).toEqual([
      {
        path: "privacy.screen_watch.recent_cap",
        labelKey: "screen.recent_cap_label",
        from: 0,
        to: 10,
      },
    ]);
    expect(stores.screenSettings.get()).toEqual({ enabled: false });
  });

  it("answers an unchanged document as a no-op", () => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, readDocument(stores));

    expect(result.direct).toEqual(Object.fromEntries(EXPOSED_PATHS.map((path) => [path, "ok"])));
    expect(result.allow).toEqual([]);
  });

  it.each(["privacy.screenshot", "bubble.keep"])("answers a dotted key %s as unknown", (key) => {
    const stores = createSettingsStores();
    const before = readDocument(stores);

    const result = applyPatch(stores, { [key]: true });

    expect(result.direct).toEqual({ [key]: `error: unknown ${key}` });
    expect(readDocument(stores)).toEqual(before);
  });

  it.each([-1, 1.5, "1", null])("rejects the screen display %j", (display) => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, { privacy: { screen_display: display } });

    expect(result.direct).toEqual({
      "privacy.screen_display": "error: invalid privacy.screen_display",
    });
  });

  it("asks to switch a window source to a display, and reads that source as no display", () => {
    const stores = createSettingsStores();
    stores.screenshotSettings.setSource({ kind: "window", app: "Cursor", window_title: "a.md" });

    expect(readDocument(stores)).toMatchObject({ privacy: { screen_display: null } });
    const result = applyPatch(stores, { privacy: { screen_display: 1 } });

    expect(result.allow).toEqual([
      { path: "privacy.screen_display", labelKey: "screenshot.source_label", from: null, to: 1 },
    ]);
    expect(applyPatch(stores, { privacy: { screen_display: null } }).direct).toEqual({
      "privacy.screen_display": "ok",
    });
  });

  it("returns one result per changed path in a mixed patch", () => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, {
      bubble: { keep: true },
      appearance: { theme: "neon" },
      endpoints: { chat: "https://example" },
      privacy: { screenshot: true, screen_display: -1 },
    });

    expect(result.direct).toEqual({
      "bubble.keep": "ok",
      "appearance.theme": "error: invalid appearance.theme",
      "endpoints.chat": "error: unknown endpoints.chat",
      "privacy.screen_display": "error: invalid privacy.screen_display",
    });
    expect(result.allow).toEqual([
      { path: "privacy.screenshot", labelKey: "screenshot.label", from: false, to: true },
    ]);
    expect(stores.bubblePersistSettings.get().enabled).toBe(true);
    expect(stores.themeSettings.get().theme).toBe("system");
    expect(stores.screenshotSettings.get().enabled).toBe(false);
  });

  it("answers an empty object at a leaf as invalid", () => {
    const stores = createSettingsStores();

    const result = applyPatch(stores, { bubble: { keep: {} } });

    expect(result.direct).toEqual({ "bubble.keep": "error: invalid bubble.keep" });
    expect(stores.bubblePersistSettings.get()).toEqual({ enabled: false });
  });
});
