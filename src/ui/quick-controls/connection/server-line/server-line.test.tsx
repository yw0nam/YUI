// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerCheck } from "../../../../io/chat/models/server-check";
import { t } from "../../../i18n";
import { ServerLine, type ServerLineRun } from "./server-line";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** Renders one line; `run` is what the page calls on entry. */
function renderLine(props: Omit<Parameters<typeof ServerLine>[0], "run">) {
  const handle: ServerLineRun = { current: null };
  const { container } = render(<ServerLine {...props} run={handle} />);
  return { section: container, run: () => act(() => handle.current!()) };
}

describe("ServerLine", () => {
  afterEach(() => {
    act(() => cleanup());
  });

  it("drops a stale result — two runs, the first resolving last keeps the second's view", async () => {
    const pending: ((result: ServerCheck | null) => void)[] = [];
    const { section, run } = renderLine({
      check: () => new Promise<ServerCheck | null>((resolve) => pending.push(resolve)),
      host: () => "h.test",
      watch: () => "https://h.test/v1",
      subscribe: () => () => {},
      subscribeKey: () => () => {},
      isOpen: () => true,
    });
    const text = () => section.querySelector<HTMLElement>(".yui-chat-status__text")!.textContent;

    run();
    run();
    expect(pending).toHaveLength(2);
    act(() => pending[1]?.({ kind: "ok" }));
    await tick();
    expect(text()).toBe(t("svc.server_connected", { host: "h.test" }));

    act(() => pending[0]?.({ kind: "unreachable" }));
    await tick();
    expect(text()).toBe(t("svc.server_connected", { host: "h.test" }));
  });

  it("does not re-check when an endpoints notify leaves the watched value unchanged", async () => {
    let notify: (() => void) | undefined;
    const check = vi.fn(async (): Promise<ServerCheck | null> => ({ kind: "ok" }));
    const { run } = renderLine({
      check,
      host: () => "h.test",
      watch: () => "https://h.test/v1",
      subscribe: (cb) => {
        notify = cb;
        return () => {};
      },
      subscribeKey: () => () => {},
      isOpen: () => true,
    });

    run();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);

    act(() => notify?.());
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("re-checks when the key store notifies", async () => {
    let keyNotify: (() => void) | undefined;
    const check = vi.fn(async (): Promise<ServerCheck | null> => ({ kind: "ok" }));
    const { run } = renderLine({
      check,
      host: () => "h.test",
      watch: () => "https://h.test/v1",
      subscribe: () => () => {},
      subscribeKey: (cb) => {
        keyNotify = cb;
        return () => {};
      },
      isOpen: () => true,
    });

    run();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);

    act(() => keyNotify?.());
    await tick();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("hides the line and checks nothing while the service has no host", async () => {
    let hostValue = "h.test";
    const check = vi.fn(async (): Promise<ServerCheck | null> => ({ kind: "ok" }));
    const { section, run } = renderLine({
      check,
      host: () => hostValue,
      watch: () => hostValue,
      subscribe: () => () => {},
      subscribeKey: () => () => {},
      isOpen: () => true,
    });
    const lineEl = section.querySelector<HTMLElement>(".yui-chat-status")!;

    run();
    await tick();
    expect(lineEl.hidden).toBe(false);

    hostValue = "";
    run();
    await tick();
    expect(lineEl.hidden).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
