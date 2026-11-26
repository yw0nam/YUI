/** yui.plugins lists, describes and calls the enabled plugins' tools and reads their skills. */

import { describe, expect, it, vi } from "vitest";
import type { McpHost, PluginHostSnapshot } from "../../../mcp-host/mcp-host";
import { runNamespace } from "../run/namespace-test-run";
import { createPluginsApi } from "./plugins-api";

const SCHEMA = { type: "object", properties: { n: { type: "integer" } }, required: ["n"] };

const SNAPSHOT: PluginHostSnapshot = {
  revision: 1,
  plugins: [
    {
      id: "p1",
      version: null,
      description: null,
      source: "local",
      path: "/plugins/p1",
      enabled: true,
      consented: true,
      error: null,
      servers: [],
      tools: [
        {
          name: "echo_args",
          server: "p1/s",
          description: "Echoes its arguments.",
          inputSchema: SCHEMA,
          meta: { "io.github.yw0nam.yui/summary": "Echo argv." },
        },
        {
          name: "odd_schema",
          server: "p1/s",
          description: "Has a schema the validator cannot use.",
          // The validator throws on this pattern, so the schema is not checked.
          inputSchema: {
            type: "object",
            properties: { a: { type: "string", pattern: "(" }, b: { type: "integer" } },
          },
          meta: null,
        },
      ],
      skills: [{ name: "hello", description: "Says hello." }],
      hidden: [],
    },
    {
      id: "off",
      version: null,
      description: null,
      source: "local",
      path: "/plugins/off",
      enabled: false,
      consented: true,
      error: null,
      servers: [],
      tools: [
        { name: "hidden_tool", server: "off/s", description: "Off.", inputSchema: {}, meta: null },
      ],
      skills: [{ name: "hidden_skill", description: "Off." }],
      hidden: [],
    },
  ],
};

function fakeHost(over: Partial<McpHost> = {}): McpHost {
  return {
    snapshot: () => SNAPSHOT,
    call: vi.fn(async () => ({ content: [{ type: "text", text: "echoed" }], isError: false })),
    cancel: vi.fn(async () => {}),
    skill: vi.fn(async () => "# hello"),
    subscribe: vi.fn(() => () => {}),
    ...over,
  };
}

function api(host: McpHost = fakeHost()) {
  return createPluginsApi({ host, presetId: () => "p1" });
}

const live = () => new AbortController().signal;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("yui.plugins.list and describe", () => {
  it("list names only the enabled plugins' tools with their summaries", async () => {
    await expect(api().methods.list(live())).resolves.toEqual([
      { name: "echo_args", summary: "Echo argv." },
      { name: "odd_schema", summary: "Has a schema the validator cannot use." },
    ]);
  });

  it("describe returns the description and the input schema", async () => {
    await expect(api().methods.describe(live(), "echo_args")).resolves.toEqual({
      description: "Echoes its arguments.",
      input_schema: SCHEMA,
    });
  });

  it("describe answers an unknown name and a disabled plugin's tool as an error value", async () => {
    await expect(api().methods.describe(live(), "nope")).resolves.toBe("error: unknown tool: nope");
    await expect(api().methods.describe(live(), "hidden_tool")).resolves.toBe(
      "error: unknown tool: hidden_tool",
    );
  });
});

describe("yui.plugins.call", () => {
  it("passes the name, the arguments and the window's preset to the host", async () => {
    const host = fakeHost();

    const result = await api(host).methods.call(live(), "echo_args", { n: 1 });

    expect(host.call).toHaveBeenCalledTimes(1);
    const [callId, name, args, presetId] = vi.mocked(host.call).mock.calls[0]!;
    expect(callId).toMatch(UUID);
    expect([name, args, presetId]).toEqual(["echo_args", { n: 1 }, "p1"]);
    expect(result).toEqual({ text: "echoed", images: [] });
  });

  it("answers an unknown tool as a value, without calling the host", async () => {
    const host = fakeHost();

    await expect(api(host).methods.call(live(), "nope", {})).resolves.toEqual({
      text: "error: unknown tool: nope",
      images: [],
    });
    expect(host.call).not.toHaveBeenCalled();
  });

  it("throws for arguments that break the tool's schema, without calling the host", async () => {
    const host = fakeHost();

    const run = await runNamespace(
      "plugins",
      api(host).methods,
      'return await yui.plugins.call("echo_args", { n: "x" })',
    );

    expect(run).toMatchObject({
      status: "error",
      error: expect.stringMatching(
        /^Error: yui\.plugins\.call: invalid arguments \(#\/n: .*\)\ninput schema: \{/,
      ),
    });
    expect(host.call).not.toHaveBeenCalled();
  });

  it("throws for arguments that are a string, an array or a name that is not a string", async () => {
    const host = fakeHost();

    for (const code of [
      'return await yui.plugins.call("echo_args", \'{"n":1}\')',
      'return await yui.plugins.call("echo_args", [1])',
      "return await yui.plugins.call(5, {})",
      "return await yui.plugins.describe(5)",
    ]) {
      const run = await runNamespace("plugins", api(host).methods, code);
      expect(run).toMatchObject({
        status: "error",
        error: expect.stringMatching(/^Error: yui\.plugins\.(call|describe): /),
      });
    }
    expect(host.call).not.toHaveBeenCalled();
  });

  it("calls with no arguments as an empty object, and null counts as absent", async () => {
    const host = fakeHost();

    const run = await runNamespace(
      "plugins",
      api(host).methods,
      'return await yui.plugins.call("odd_schema", undefined)',
    );

    expect(run.status).toBe("completed");
    expect(host.call).toHaveBeenCalledWith(expect.any(String), "odd_schema", {}, "p1");
  });

  it("still calls a tool whose schema the validator cannot use", async () => {
    const host = fakeHost();

    await api(host).methods.call(live(), "odd_schema", { a: "x", b: "no" });

    expect(host.call).toHaveBeenCalledTimes(1);
  });

  it("cancels the host call by its id when the signal aborts", async () => {
    const abort = new AbortController();
    let callId = "";
    const host = fakeHost({
      call: vi.fn(async (id: string) => {
        callId = id;
        await new Promise((resolve) => abort.signal.addEventListener("abort", resolve));
        return { content: [], isError: false };
      }),
    });

    const running = api(host).methods.call(abort.signal, "echo_args", { n: 1 });
    await vi.waitFor(() => expect(callId).not.toBe(""));
    abort.abort();
    await running;

    expect(host.cancel).toHaveBeenCalledWith(callId);
  });

  it("calls nothing when the signal is already aborted", async () => {
    const host = fakeHost();
    const abort = new AbortController();
    abort.abort();

    await expect(api(host).methods.call(abort.signal, "echo_args", { n: 1 })).resolves.toEqual({
      text: "error: turn stopped",
      images: [],
    });
    expect(host.call).not.toHaveBeenCalled();
  });

  it("gives an isError result the error prefix and keeps one it already has", async () => {
    const results = [
      { content: [{ type: "text", text: "boom" }], isError: true },
      { content: [{ type: "text", text: "error: boom" }], isError: true },
    ];
    const host = fakeHost({ call: vi.fn(async () => results.shift()!) });
    const plugins = api(host);

    await expect(plugins.methods.call(live(), "echo_args", { n: 1 })).resolves.toEqual({
      text: "error: boom",
      images: [],
    });
    await expect(plugins.methods.call(live(), "echo_args", { n: 1 })).resolves.toEqual({
      text: "error: boom",
      images: [],
    });
  });

  it("returns images as data URLs", async () => {
    const host = fakeHost({
      call: vi.fn(async () => ({
        content: [
          { type: "text", text: "shot" },
          { type: "image", mimeType: "image/png", data: "AAAA" },
        ],
        isError: false,
      })),
    });

    await expect(api(host).methods.call(live(), "echo_args", { n: 1 })).resolves.toEqual({
      text: "shot",
      images: ["data:image/png;base64,AAAA"],
    });
  });

  it("answers a rejection as a value", async () => {
    const host = fakeHost({ call: vi.fn(async () => Promise.reject("plugin tool timed out")) });

    await expect(api(host).methods.call(live(), "echo_args", { n: 1 })).resolves.toEqual({
      text: "error: plugin tool timed out",
      images: [],
    });
  });
});

describe("yui.plugins skill and listing", () => {
  it("skill returns the body, or the error text when the host rejects", async () => {
    await expect(api().skill("hello")).resolves.toBe("# hello");
    const host = fakeHost({ skill: vi.fn(async () => Promise.reject("unknown plugin skill: x")) });
    await expect(api(host).skill("x")).resolves.toBe("error: unknown plugin skill: x");
  });

  it("listing names the enabled tools and skills and drops a disabled plugin's", () => {
    expect(api().listing()).toBe(
      "Plugin tools, run with yui.plugins.call: echo_args — Echo argv. · odd_schema — Has a schema the validator cannot use." +
        ' Plugin skills, read with help("plugin:<name>"): hello — Says hello.',
    );
  });

  it("listing leaves out a sentence with no entries, and is empty with none", () => {
    const noSkills: PluginHostSnapshot = {
      ...SNAPSHOT,
      plugins: [{ ...SNAPSHOT.plugins[0]!, skills: [] }],
    };
    expect(api(fakeHost({ snapshot: () => noSkills })).listing()).toBe(
      "Plugin tools, run with yui.plugins.call: echo_args — Echo argv. · odd_schema — Has a schema the validator cannot use.",
    );
    expect(api(fakeHost({ snapshot: () => null })).listing()).toBe("");
  });

  it("listing follows the host's snapshot on each read", () => {
    let snapshot: PluginHostSnapshot | null = null;
    const plugins = api(fakeHost({ snapshot: () => snapshot }));

    expect(plugins.listing()).toBe("");
    snapshot = SNAPSHOT;
    expect(plugins.listing()).not.toBe("");
  });
});
