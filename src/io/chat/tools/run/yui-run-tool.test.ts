/**
 * yui-run-tool.test.ts — the yui_run tool: a script reads and patches the settings document,
 * and a write that needs the user's allow asks once and applies only what the user allowed.
 */

import { describe, expect, it, vi } from "vitest";
import { createSettingsStores } from "../../../../settings/settings-stores";
import { createSettingsApi, type RequestSettings, type SettingsAnswer } from "./settings-api";
import { stubYuiRunPorts } from "./yui-run-test-ports";
import { createYuiRunTool } from "./yui-run-tool";

function harness(answer: SettingsAnswer = "allow") {
  const stores = createSettingsStores();
  const request = vi.fn<RequestSettings>(async () => answer);
  const tool = createYuiRunTool({
    ...stubYuiRunPorts(),
    settings: createSettingsApi({ stores, request }),
  });
  const run = async (code: string, signal?: AbortSignal) =>
    JSON.parse(String(await tool.execute({ code }, signal)));
  return { stores, request, tool, run };
}

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
      "console.log('hi', 1); return [help(), (await yui.state.read()).permissions, await yui.info.read()]",
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
    const { run, stores, request } = harness("allow");

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
    ["deny", "denied"],
    ["no answer", "no answer"],
  ] as const)("applies no allow path when the user's answer is %s", async (answer, path) => {
    const { run, stores } = harness(answer);

    const result = await run(PRIVACY_PATCH);

    expect(result.result).toEqual({ "privacy.screenshot": path, "privacy.screen_requests": path });
    expect(stores.screenshotSettings.get()).toMatchObject({ enabled: false, allowRequests: false });
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

  it("answers invalid for an allowed value the store no longer accepts", async () => {
    const { run, stores, request } = harness();
    request.mockImplementation(async () => {
      vi.spyOn(stores.screenshotSettings, "get").mockReturnValue({
        enabled: false,
        allowRequests: false,
        source: { kind: "monitor", index: -1 },
      });
      return "allow";
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
});
