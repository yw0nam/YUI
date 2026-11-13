/** presence.test.ts — the OS idle tick read against the away threshold. */

import { expect, it, vi } from "vitest";
import type { OsEventListen, OsEventPayload } from "../window/tauri-listen";
import { createPresence } from "./presence";

function fakeListen(): {
  listen: OsEventListen;
  subscribed(): boolean;
  tick(os_idle_ms: number): void;
} {
  const handlers = new Set<(e: { payload: OsEventPayload }) => void>();
  const listen: OsEventListen = async (_event, handler) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  };
  return {
    listen,
    subscribed: () => handlers.size > 0,
    tick: (os_idle_ms) => {
      for (const handler of handlers)
        handler({ payload: { event_name: "os_idle_tick", ts: 0, data: { os_idle_ms } } });
    },
  };
}

it("reads the OS idle tick against the away threshold", async () => {
  const { listen, subscribed, tick } = fakeListen();
  const presence = createPresence({ threshold: () => 5000, listen });

  await vi.waitFor(() => expect(subscribed()).toBe(true));
  expect(presence.isPresent()).toBe(false);

  tick(1000);
  expect(presence.isPresent()).toBe(true);

  tick(9000);
  expect(presence.isPresent()).toBe(false);

  presence.dispose();
});
