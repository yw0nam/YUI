/** threads-client.test.ts — the webview side of the Thread store: the newest snapshot and the answer command. */

import { expect, it, vi } from "vitest";
import type { Thread, ThreadsSnapshot } from "../../contract";
import { createThreadsClient } from "./threads-client";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../tauri-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../tauri-env")>()),
  isTauri: () => true,
}));

const SNAPSHOT = (revision: number, threads: ThreadsSnapshot["threads"] = []): ThreadsSnapshot => ({
  revision,
  threads,
});

const thread = (id: string): Thread => ({
  id,
  source: "codex",
  title: id,
  state: "input-required",
  entries: [],
  created_at: 0,
  updated_at: 1,
});

it("keeps the highest revision and ignores an older snapshot event", async () => {
  const events = { emit: (_payload: ThreadsSnapshot) => {} };
  mocks.listen.mockImplementation(
    async (_event: string, handler: (e: { payload: ThreadsSnapshot }) => void) => {
      events.emit = (payload) => handler({ payload });
      return () => {};
    },
  );
  mocks.invoke.mockResolvedValue(SNAPSHOT(5));
  const client = createThreadsClient();
  const seen: number[] = [];
  client.subscribe((snapshot) => seen.push(snapshot.revision));
  await vi.waitFor(() => expect(client.snapshot()?.revision).toBe(5));

  events.emit(SNAPSHOT(3));
  events.emit(SNAPSHOT(7));

  expect(client.snapshot()?.revision).toBe(7);
  expect(seen).toEqual([5, 7]);
  expect(mocks.listen).toHaveBeenCalledWith("threads-snapshot", expect.any(Function));
});

it("reads the kept snapshot's Thread list, empty before the first snapshot", async () => {
  const events = { emit: (_payload: ThreadsSnapshot) => {} };
  mocks.listen.mockImplementation(
    async (_event: string, handler: (e: { payload: ThreadsSnapshot }) => void) => {
      events.emit = (payload) => handler({ payload });
      return () => {};
    },
  );
  mocks.invoke.mockResolvedValue(SNAPSHOT(1));
  const client = createThreadsClient();
  expect(client.threads()).toEqual([]);

  await vi.waitFor(() => expect(client.snapshot()).not.toBeNull());
  events.emit(SNAPSHOT(2, [thread("t1")]));

  expect(client.threads().map((thread) => thread.id)).toEqual(["t1"]);
});

it("answers through thread_answer with the ask id and only the given fields", async () => {
  mocks.listen.mockResolvedValue(() => {});
  mocks.invoke.mockResolvedValue(undefined);
  const client = createThreadsClient();

  await client.answer("t1", "a1", { choice: "allow" });

  expect(mocks.invoke).toHaveBeenCalledWith("thread_answer", {
    id: "t1",
    askId: "a1",
    choice: "allow",
  });
});
