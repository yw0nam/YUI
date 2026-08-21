/**
 * ingress-dead-notice.test.ts — the agent-ingress listener died (port bind failed
 * after retries): the Rust side emits ingress-dead and the pet window surfaces a
 * one-off bubble notice instead of dropping agent events silently.
 */

import { describe, expect, it, vi } from "vitest";
import { wireIngressDeadNotice } from "./ingress-dead-notice";

function fakeSurfaces() {
  return { beginSpeech: vi.fn(), pushSpeech: vi.fn(), endSpeech: vi.fn() };
}

describe("wireIngressDeadNotice", () => {
  it("shows the notice through the bubble when the event fires", () => {
    const surfaces = fakeSurfaces();
    let fire: (p: { port: number }) => void = () => {};
    wireIngressDeadNotice({
      surfaces,
      t: (key: string) => `[${key}]`,
      onInbox: (cb) => {
        fire = cb;
        return () => {};
      },
    });

    fire({ port: 8770 });

    expect(surfaces.beginSpeech).toHaveBeenCalled();
    expect(surfaces.pushSpeech).toHaveBeenCalledWith("[ingress.dead_notice]");
    expect(surfaces.endSpeech).toHaveBeenCalled();
  });

  it("returns the inbox unsubscribe", () => {
    const off = vi.fn();
    const unsubscribe = wireIngressDeadNotice({
      surfaces: fakeSurfaces(),
      t: (key: string) => key,
      onInbox: () => off,
    });

    unsubscribe();

    expect(off).toHaveBeenCalled();
  });
});
