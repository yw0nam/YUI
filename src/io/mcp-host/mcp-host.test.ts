/**
 * mcp-host.test.ts — the webview side of the MCP host.
 *
 * The client keeps the newest snapshot it sees and reaches the host's call, cancel and skill
 * commands.
 */

import { describe, expect, it, vi } from "vitest";
import { createMcpHost, type PluginHostSnapshot } from "./mcp-host";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../tauri-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../tauri-env")>()),
  isTauri: () => true,
}));

const SNAPSHOT = (revision: number): PluginHostSnapshot => ({
  revision,
  plugins: [
    {
      id: "p1",
      enabled: true,
      tools: [
        { name: "echo_args", server: "p1/s", description: "Echo.", inputSchema: {}, meta: null },
      ],
      skills: [],
    },
  ],
});

/** The mocked host: the snapshot invoke answers a revision, the event subscription is captured. */
function mockHost(revision: number): { emit: (payload: PluginHostSnapshot) => void } {
  const events = { emit: (_payload: PluginHostSnapshot) => {} };
  mocks.listen.mockImplementation(
    async (_event: string, handler: (e: { payload: PluginHostSnapshot }) => void) => {
      events.emit = (payload) => handler({ payload });
      return () => {};
    },
  );
  mocks.invoke.mockImplementation((command: string) =>
    command === "plugin_host_snapshot"
      ? Promise.resolve(SNAPSHOT(revision))
      : Promise.resolve(undefined),
  );
  return events;
}

describe("createMcpHost", () => {
  it("keeps the newest snapshot between the invoked one and the events", async () => {
    const events = mockHost(5);
    const host = createMcpHost();
    await vi.waitFor(() => expect(host.snapshot()?.revision).toBe(5));

    events.emit(SNAPSHOT(3));
    expect(host.snapshot()?.revision).toBe(5);

    events.emit(SNAPSHOT(7));
    expect(host.snapshot()?.revision).toBe(7);
  });

  it("keeps the newest snapshot when an event arrives before the read resolves", async () => {
    const events = { emit: (_payload: PluginHostSnapshot) => {} };
    const read = { resolve: (_snapshot: PluginHostSnapshot) => {} };
    mocks.listen.mockImplementation(
      async (_event: string, handler: (e: { payload: PluginHostSnapshot }) => void) => {
        events.emit = (payload) => handler({ payload });
        return () => {};
      },
    );
    mocks.invoke.mockImplementation((command: string) =>
      command === "plugin_host_snapshot"
        ? new Promise<PluginHostSnapshot>((resolve) => {
            read.resolve = resolve;
          })
        : Promise.resolve(undefined),
    );
    const host = createMcpHost();

    events.emit(SNAPSHOT(7));
    await vi.waitFor(() => expect(read.resolve).toBeDefined());
    read.resolve(SNAPSHOT(5));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.snapshot()?.revision).toBe(7);
  });

  it("reads the snapshot only after the subscription is registered", async () => {
    const gate = { open: () => {} };
    mocks.listen.mockImplementation(
      async (_event: string, _handler: (e: { payload: PluginHostSnapshot }) => void) =>
        new Promise<() => void>((resolve) => {
          gate.open = () => resolve(() => {});
        }),
    );
    mocks.invoke.mockImplementation((command: string) =>
      command === "plugin_host_snapshot"
        ? Promise.resolve(SNAPSHOT(1))
        : Promise.resolve(undefined),
    );
    createMcpHost();
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    expect(mocks.invoke).not.toHaveBeenCalled();

    gate.open();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("plugin_host_snapshot"));
  });

  it("calls a plugin tool through the host", async () => {
    mockHost(1);
    const host = createMcpHost();

    await host.call("c1", "echo_args", { n: 1 }, "p1");

    expect(mocks.invoke).toHaveBeenCalledWith("plugin_host_call", {
      callId: "c1",
      name: "echo_args",
      arguments: { n: 1 },
      presetId: "p1",
    });
  });
});
