/** terminal-client.test.ts — the webview side of the terminal store: the newest snapshot and the attach byte stream. */

import { expect, it, vi } from "vitest";
import type { TerminalSnapshot } from "../../contract";
import { createTerminalClient } from "./terminal-client";

const mocks = vi.hoisted(() => {
  const channels: { onmessage?: (message: ArrayBuffer) => void }[] = [];
  return {
    invoke: vi.fn(),
    listen: vi.fn(),
    channels,
    Channel: vi.fn(function (this: unknown) {
      const channel: { onmessage?: (message: ArrayBuffer) => void } = {};
      channels.push(channel);
      return channel;
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: mocks.Channel }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../tauri-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../tauri-env")>()),
  isTauri: () => true,
}));

const SNAPSHOT = (revision: number): TerminalSnapshot => ({
  revision,
  terminals: [],
  requests: [],
});

it("keeps the highest revision and ignores an older snapshot event", async () => {
  let emit: ((event: { payload: TerminalSnapshot }) => void) | undefined;
  mocks.listen.mockImplementation(
    async (
      _name: string,
      handler: (event: { payload: TerminalSnapshot }) => Promise<void> | void,
    ) => {
      emit = handler;
      return () => {};
    },
  );
  mocks.invoke.mockResolvedValue(SNAPSHOT(5));
  const client = createTerminalClient();
  expect(client.snapshot()).toBeNull();
  const seen: number[] = [];
  client.subscribe((snapshot) => seen.push(snapshot.revision));
  await vi.waitFor(() => expect(client.snapshot()?.revision).toBe(5));

  emit!({ payload: SNAPSHOT(3) });
  expect(client.snapshot()?.revision).toBe(5);
  emit!({ payload: SNAPSHOT(7) });

  expect(client.snapshot()?.revision).toBe(7);
  expect(seen).toEqual([5, 7]);
  expect(mocks.listen).toHaveBeenCalledWith("terminal-snapshot", expect.any(Function));
});

it("attach passes a channel to terminal_attach and delivers its bytes to onBytes", async () => {
  mocks.listen.mockResolvedValue(() => {});
  mocks.invoke.mockResolvedValue(undefined);
  const client = createTerminalClient();
  const onBytes = vi.fn();

  await client.attach("t1", onBytes);

  const channel = mocks.channels.at(-1)!;
  expect(mocks.invoke).toHaveBeenCalledWith("terminal_attach", { id: "t1", onOutput: channel });
  channel.onmessage!(new TextEncoder().encode("hi").buffer as ArrayBuffer);
  expect(onBytes).toHaveBeenCalledWith(new Uint8Array([104, 105]));
});
