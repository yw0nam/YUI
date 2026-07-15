/**
 * tauri-listen.test.ts — shared Tauri `listen` resolver.
 *
 * Locks:
 *  - off-Tauri (no __TAURI_INTERNALS__): resolveTauriListen() returns undefined.
 *  - subscribeOsEvent() forwards payloads and returns the unlisten callback.
 *  - missing or failed listeners degrade without throwing.
 */

import { describe, expect, it, vi } from "vitest";
import {
  OS_EVENT_CHANNEL,
  type OsEventListen,
  type OsEventPayload,
  resolveTauriListen,
  subscribeOsEvent,
} from "./tauri-listen";

describe("tauri-listen — resolveTauriListen", () => {
  it("returns undefined off-Tauri (no __TAURI_INTERNALS__)", async () => {
    expect((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__).toBeUndefined();
    await expect(resolveTauriListen()).resolves.toBeUndefined();
  });
});

describe("tauri-listen — subscribeOsEvent", () => {
  it("returns unlisten and forwards emitted payloads", async () => {
    const payload: OsEventPayload = {
      event_name: "window_changed",
      ts: 123,
      data: { active_app_name: "Example" },
    };
    const unlisten = vi.fn();
    let handler: ((event: { payload: OsEventPayload }) => void) | undefined;
    const listen: OsEventListen = vi.fn(async (_event, capturedHandler) => {
      handler = capturedHandler;
      return unlisten;
    });
    const onTick = vi.fn();
    const log = { debug: vi.fn() };

    const result = await subscribeOsEvent({ listen, onTick, log });
    handler?.({ payload });

    expect(listen).toHaveBeenCalledWith(OS_EVENT_CHANNEL, expect.any(Function));
    expect(result).toBe(unlisten);
    expect(onTick).toHaveBeenCalledWith(payload);
  });

  it("returns undefined without logging when no listen is available", async () => {
    const onTick = vi.fn();
    const log = { debug: vi.fn() };

    await expect(resolveTauriListen()).resolves.toBeUndefined();
    await expect(subscribeOsEvent({ listen: undefined, onTick, log })).resolves.toBeUndefined();

    expect(log.debug).not.toHaveBeenCalled();
  });

  it("logs the default tag when subscribing fails", async () => {
    const error = new Error("subscribe rejected");
    const listen: OsEventListen = vi.fn(async () => {
      throw error;
    });
    const log = { debug: vi.fn() };

    await expect(subscribeOsEvent({ listen, onTick: vi.fn(), log })).resolves.toBeUndefined();

    expect(log.debug).toHaveBeenCalledWith("subscribe_failed", {
      degrade: true,
      error: String(error),
    });
  });

  it("logs the custom tag when subscribing fails", async () => {
    const error = new Error("idle subscribe rejected");
    const listen: OsEventListen = vi.fn(async () => {
      throw error;
    });
    const log = { debug: vi.fn() };

    await expect(
      subscribeOsEvent({
        listen,
        onTick: vi.fn(),
        log,
        subscribeTag: "subscribe_idle_failed",
      }),
    ).resolves.toBeUndefined();

    expect(log.debug).toHaveBeenCalledWith("subscribe_idle_failed", {
      degrade: true,
      error: String(error),
    });
  });
});
