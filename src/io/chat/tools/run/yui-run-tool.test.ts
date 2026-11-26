/**
 * yui-run-tool.test.ts — the yui_run tool: a script reads and patches the settings document,
 * and a write that needs the user's allow asks once and applies only what the user allowed.
 */

import { describe, expect, it, vi } from "vitest";
import { createSettingsStores } from "../../../../settings/settings-stores";
import { createSettingsApi, type RequestSettings, type SettingsDecision } from "./settings-api";
import { stubYuiRunPorts } from "./yui-run-test-ports";
import {
  createYuiRunTool,
  type PluginsNamespace,
  type YuiMethod,
  type YuiNamespace,
  type YuiRunPorts,
} from "./yui-run-tool";

/** Without a decision, the user allows every path asked. */
function harness(decision?: SettingsDecision) {
  const stores = createSettingsStores();
  const request = vi.fn<RequestSettings>(
    async ({ changes }) => decision ?? { allow: changes.map((change) => change.path) },
  );
  const tool = createYuiRunTool({
    ...stubYuiRunPorts(),
    settings: createSettingsApi({ stores, request }),
  });
  const run = async (code: string, signal?: AbortSignal) =>
    JSON.parse(String(await tool.execute({ code }, signal)));
  return { stores, request, tool, run };
}

/** A namespace of the given methods, its help() block the given text. */
const ns = (methods: Record<string, YuiMethod>, declaration = ""): YuiNamespace => ({
  methods,
  declaration,
});

/** A plugins namespace with one tool, whose listing() reads the given text when it is called. */
function plugins(listing: () => string = () => ""): PluginsNamespace {
  return {
    ...ns({ call: async () => ({ text: "ran", images: [] }) }, "PLUGINS"),
    skill: async (name) => `skill body of ${name}`,
    listing,
  };
}

/** The tool with the stub ports and the given namespaces. */
const toolWith = (
  namespaces: YuiRunPorts["namespaces"],
  ports: Partial<Omit<YuiRunPorts, "namespaces">> = {},
) => createYuiRunTool({ ...stubYuiRunPorts(), ...ports, namespaces });

const parsed = async (answer: Promise<unknown>) => JSON.parse(String(await answer));

const PRIVACY_PATCH =
  "return await yui.settings.write({ privacy: { screenshot: true, screen_requests: true } }, { why: 'look at your screen' })";

describe("createYuiRunTool", () => {
  it("is a function tool with a required code string and the wait above one Settings request", () => {
    const { tool } = harness();

    expect(tool.name).toBe("yui_run");
    expect(tool.definition.function).toMatchObject({
      name: "yui_run",
      parameters: { properties: { code: { type: "string" } }, required: ["code"] },
    });
    expect(tool.waitMs).toBe(121_000);
  });

  it("describes the call exactly as the contract words it", () => {
    const { tool } = harness();

    expect(tool.definition.function.description).toBe(
      "Run JavaScript against YUI's yui API and get its result. Start with return help(): it returns the API as text. The code is an async function body: use await, and end with return and a JSON value.",
    );
  });

  it("answers the script's result and logs, and gives it help, state and info", async () => {
    const { run } = harness();

    const result = await run(
      "console.log('hi', 1); return [await help(), (await yui.state.read()).permissions, await yui.info.read()]",
    );

    expect(result).toEqual({
      status: "completed",
      result: [
        "help text",
        { screen_recording: "granted" },
        { bodies: [], voices: [], monitors: [] },
      ],
      logs: ["hi 1"],
    });
  });

  it("reads the settings document", async () => {
    const { run } = harness();

    const result = await run("return (await yui.settings.read()).bubble");

    expect(result.result).toEqual({ keep: false });
  });

  it("writes a direct path at once without asking", async () => {
    const { run, stores, request } = harness();

    const result = await run("return await yui.settings.write({ bubble: { keep: true } })");

    expect(result.result).toEqual({ "bubble.keep": "ok" });
    expect(stores.bubblePersistSettings.get().enabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("asks once for every allow path of a write and answers each path", async () => {
    const { run, stores, request } = harness();

    const result = await run(
      "return await yui.settings.write({ bubble: { keep: true }, privacy: { screenshot: true, screen_requests: true } }, { why: 'look at your screen' })",
    );

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      {
        changes: [
          { path: "privacy.screenshot", labelKey: "screenshot.label", from: false, to: true },
          {
            path: "privacy.screen_requests",
            labelKey: "screenshot.request_label",
            from: false,
            to: true,
          },
        ],
        why: "look at your screen",
      },
      expect.any(AbortSignal),
    );
    expect(result.result).toEqual({
      "bubble.keep": "ok",
      "privacy.screenshot": "ok",
      "privacy.screen_requests": "ok",
    });
    expect(stores.screenshotSettings.get()).toMatchObject({ enabled: true, allowRequests: true });
  });

  it.each([
    [{ allow: [] }, "denied"],
    ["no answer", "no answer"],
  ] as const)("applies no allow path when the user's answer is %s", async (answer, path) => {
    const { run, stores } = harness(answer);

    const result = await run(PRIVACY_PATCH);

    expect(result.result).toEqual({ "privacy.screenshot": path, "privacy.screen_requests": path });
    expect(stores.screenshotSettings.get()).toMatchObject({ enabled: false, allowRequests: false });
  });

  it.each([
    [
      { allow: ["privacy.screenshot"], note: "only the bubble" },
      "ok: only the bubble",
      "denied: only the bubble",
      true,
    ],
    [{ allow: ["privacy.screenshot"] }, "ok", "denied", true],
    [
      { allow: [], note: "only the bubble" },
      "denied: only the bubble",
      "denied: only the bubble",
      false,
    ],
  ])("answers the decision %j with %s and %s", async (decision, screenshot, requests, enabled) => {
    const { run, stores } = harness(decision);

    const result = await run(PRIVACY_PATCH);

    expect(result.result).toEqual({
      "privacy.screenshot": screenshot,
      "privacy.screen_requests": requests,
    });
    expect(stores.screenshotSettings.get()).toMatchObject({ enabled, allowRequests: false });
  });

  it("maps a busy answer to the error for every allow path and keeps the direct paths", async () => {
    const { run, stores } = harness("busy");

    const result = await run(
      "return await yui.settings.write({ bubble: { keep: true }, privacy: { screenshot: true } })",
    );

    expect(result.result).toEqual({
      "bubble.keep": "ok",
      "privacy.screenshot": "error: a settings request is already waiting",
    });
    expect(stores.screenshotSettings.get()).toMatchObject({ enabled: false });
  });

  it.each([
    [
      "a hand-made return value",
      "await yui.settings.write({ bubble: { keep: true } }); await yui.settings.write(null); return { status: 'ok' }",
      {
        status: "completed",
        result: { status: "ok" },
        logs: [],
        writes: [{ "bubble.keep": "ok" }, { "*": "error: patch must be an object" }],
      },
    ],
    [
      "a throw after a write",
      "await yui.settings.write({ privacy: { screenshot: true } }, { why: 'look at your screen' }); throw new Error('boom')",
      {
        status: "error",
        error: "Error: boom",
        logs: [],
        writes: [{ "privacy.screenshot": "ok" }],
      },
    ],
  ])("lists every write's answers under writes, beside %s", async (_name, code, envelope) => {
    const { run } = harness();

    expect(await run(code)).toEqual(envelope);
  });

  it("carries no writes key when the run wrote nothing", async () => {
    const { run } = harness();

    const result = await run("return 1");

    expect(result).toEqual({ status: "completed", result: 1, logs: [] });
    expect(result).not.toHaveProperty("writes");
  });

  it("answers invalid, with no note, for an allowed value the store no longer accepts", async () => {
    const { run, stores, request } = harness();
    request.mockImplementation(async () => {
      vi.spyOn(stores.screenshotSettings, "get").mockReturnValue({
        enabled: false,
        allowRequests: false,
        source: { kind: "monitor", index: -1 },
      });
      return { allow: ["privacy.screenshot"], note: "only the bubble" };
    });

    const result = await run("return await yui.settings.write({ privacy: { screenshot: true } })");

    expect(result.result).toEqual({ "privacy.screenshot": "error: invalid privacy.screenshot" });
    expect(stores.screenshotSettings.current().enabled).toBe(false);
  });

  it("withdraws a pending request when the call is aborted", async () => {
    const { run, request } = harness();
    let seen: AbortSignal | undefined;
    request.mockImplementation((_req, signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const stop = new AbortController();

    const pending = run(PRIVACY_PATCH, stop.signal);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    stop.abort();

    expect(await pending).toMatchObject({ status: "error", error: "stopped" });
    expect(seen?.aborted).toBe(true);
  });

  it.each([
    ['{"status":"completed","result":1,"logs":[]}', false],
    ['{"status":"error","error":"boom","logs":[]}', true],
    ["error: timed out after 121 s", true],
  ])("reads %s as failed: %s", (text, failed) => {
    const { tool } = harness();

    expect(tool.failed?.(text)).toBe(failed);
  });

  it("answers a call without a code string as an error result", async () => {
    const { tool } = harness();

    const text = String(await tool.execute({ code: 1 }));

    expect(JSON.parse(text)).toEqual({ status: "error", error: "code must be a string", logs: [] });
    expect(tool.failed?.(text)).toBe(true);
  });

  it.each([
    ["a string", "return await yui.settings.write('x')"],
    ["null", "return await yui.settings.write(null)"],
  ])("answers a shape error for a patch that is %s, without asking", async (_shape, code) => {
    const { run, request, stores } = harness();

    const result = await run(code);

    expect(result.result).toEqual({ "*": "error: patch must be an object" });
    expect(request).not.toHaveBeenCalled();
    expect(stores.bubblePersistSettings.get().enabled).toBe(false);
  });

  it("answers a shape error for a non-string why, without asking", async () => {
    const { run, request, stores } = harness();

    const result = await run(
      "return await yui.settings.write({ bubble: { keep: true } }, { why: 5 })",
    );

    expect(result.result).toEqual({ "*": "error: why must be a string" });
    expect(request).not.toHaveBeenCalled();
    expect(stores.bubblePersistSettings.get().enabled).toBe(false);
  });

  it("rejects a readings text above the row's cap as invalid", async () => {
    const { run } = harness();

    const result = await run(
      "return await yui.settings.write({ voice: { readings: 'a'.repeat(4e6) } })",
    );

    expect(result.result).toEqual({ "voice.readings": "error: invalid voice.readings" });
  });

  it("attaches the images whose handles the result holds, in ascending handle order", async () => {
    const tool = toolWith({
      look: ns({ screen: async () => ({ text: "s", images: ["data:a", "data:b"] }) }),
    });

    const answer = await tool.execute({
      code: "const s = await yui.look.screen(); return [s.images[1], s.images[0]]",
    });

    expect(typeof answer).toBe("object");
    const { text, images } = answer as { text: string; images: string[] };
    expect(images).toEqual(["data:a", "data:b"]);
    expect(JSON.parse(text)).toEqual({
      status: "completed",
      result: [{ image: 2 }, { image: 1 }],
      images: [1, 2],
      logs: [],
    });
  });

  it.each([
    [
      "only logs a handle",
      "const s = await yui.look.screen(); console.log(s.images[0]); return 1",
      { status: "completed", result: 1, logs: ['{"image":1}'] },
    ],
    [
      "ends in an error",
      "const s = await yui.look.screen(); throw new Error(JSON.stringify(s.images[0]))",
      { status: "error", error: 'Error: {"image":1}', logs: [] },
    ],
  ])("attaches no image when the run %s", async (_case, code, envelope) => {
    const tool = toolWith({
      look: ns({ screen: async () => ({ text: "s", images: ["data:a"] }) }),
    });

    const answer = await tool.execute({ code });

    expect(typeof answer).toBe("string");
    expect(JSON.parse(answer as string)).toEqual(envelope);
  });

  it("aborts a yui call still running once the run ends", async () => {
    let seen: AbortSignal | undefined;
    const read = vi.fn<YuiMethod>((signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const tool = toolWith({ terminal: ns({ read }) });

    const result = await parsed(
      tool.execute({ code: 'const p = yui.terminal.read("t"); await yui.state.read(); return 1' }),
    );

    expect(result).toEqual({ status: "completed", result: 1, logs: [] });
    expect(read).toHaveBeenCalledWith(expect.any(AbortSignal), "t");
    expect(seen?.aborted).toBe(true);
  });

  it("names look, terminal, threads and the plugin tool to the status pill, and no other call", async () => {
    const answer = async () => "ok";
    const tool = toolWith({
      look: ns({ body: answer }),
      terminal: ns({ list: answer }),
      threads: ns({ list: answer }),
      guide: ns({ read: answer }),
      plugins: plugins(),
    });
    const status = vi.fn();

    const result = await parsed(
      tool.execute(
        {
          code: [
            "await yui.settings.read(); await yui.state.read(); await yui.info.read();",
            'await yui.guide.read("controls"); await yui.look.body(); await yui.terminal.list();',
            'await yui.threads.list(); await yui.plugins.call("hello_tool", {}); return 1',
          ].join(" "),
        },
        undefined,
        { status },
      ),
    );

    expect(result.status).toBe("completed");
    expect(status.mock.calls).toEqual([["look"], ["terminal"], ["threads"], ["hello_tool"]]);
  });

  it("prints in help() the declarations of the namespaces the window has, in order", async () => {
    const help = (declarations: readonly string[]) => declarations.join("|");
    const code = { code: "return await help()" };
    const full = toolWith(
      {
        threads: ns({}, "THREADS"),
        look: ns({}, "LOOK"),
        plugins: plugins(),
        terminal: ns({}, "TERMINAL"),
        guide: ns({}, "GUIDE"),
      },
      { help },
    );
    const bare = toolWith({}, { help });

    expect((await parsed(full.execute(code))).result).toBe("GUIDE|TERMINAL|PLUGINS|LOOK|THREADS");
    expect((await parsed(bare.execute(code))).result).toBe("");
  });

  it("reads a plugin skill through help, and ends the run for any other topic", async () => {
    const tool = toolWith({ plugins: plugins() });

    const skill = await parsed(tool.execute({ code: 'return await help("plugin:hello")' }));
    const other = await parsed(tool.execute({ code: 'return await help("x")' }));

    expect(skill.result).toBe("skill body of hello");
    expect(other).toEqual({
      status: "error",
      error: "Error: help: topic must be plugin:<name>",
      logs: [],
    });
  });

  it("lists the plugins in its description as they are when the definition is read", () => {
    let listing = "Plugin tools, run with yui.plugins.call: a.";
    const tool = toolWith({ plugins: plugins(() => listing) });
    const lead =
      "Run JavaScript against YUI's yui API and get its result. Start with return help(): it returns the API as text. The code is an async function body: use await, and end with return and a JSON value.";

    const before = tool.definition.function.description;
    listing = "Plugin tools, run with yui.plugins.call: b.";

    expect(before).toBe(`${lead} Plugin tools, run with yui.plugins.call: a.`);
    expect(tool.definition.function.description).toBe(
      `${lead} Plugin tools, run with yui.plugins.call: b.`,
    );
  });

  it("shows its status from the client's own run", () => {
    expect(toolWith({}).localStatus).toBe(true);
  });
});
