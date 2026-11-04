// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ServerCheck } from "../../../../io/chat/models/server-check";
import { t } from "../../../i18n";
import { createServerLine } from "./server-line";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function lineSection(): HTMLElement {
  const section = document.createElement("section");
  section.innerHTML =
    '<p class="yui-chat-status" hidden><span class="yui-chat-status__dot"></span><span class="yui-chat-status__text"></span><button class="yui-chat-status__action" hidden></button></p>';
  return section;
}

describe("createServerLine", () => {
  it("drops a stale result — two runs, the first resolving last keeps the second's view", async () => {
    const pending: ((result: ServerCheck | null) => void)[] = [];
    const section = lineSection();
    const line = createServerLine({
      section,
      check: () => new Promise<ServerCheck | null>((resolve) => pending.push(resolve)),
      host: () => "h.test",
      watch: () => "https://h.test/v1",
      subscribe: () => () => {},
      subscribeKey: () => () => {},
      isOpen: () => true,
    });
    const text = () =>
      section.querySelector<HTMLElement>(".yui-chat-status__text")!.textContent;

    line.run();
    line.run();
    expect(pending).toHaveLength(2);
    pending[1]?.({ kind: "ok" });
    await tick();
    expect(text()).toBe(t("svc.server_connected", { host: "h.test" }));

    pending[0]?.({ kind: "unreachable" });
    await tick();
    expect(text()).toBe(t("svc.server_connected", { host: "h.test" }));
  });

  it("does not re-check when an endpoints notify leaves the watched value unchanged", async () => {
    let notify: (() => void) | undefined;
    const check = vi.fn(async (): Promise<ServerCheck | null> => ({ kind: "ok" }));
    const section = lineSection();
    const line = createServerLine({
      section,
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

    line.run();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);

    notify?.();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("re-checks when the key store notifies", async () => {
    let keyNotify: (() => void) | undefined;
    const check = vi.fn(async (): Promise<ServerCheck | null> => ({ kind: "ok" }));
    const section = lineSection();
    const line = createServerLine({
      section,
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

    line.run();
    await tick();
    expect(check).toHaveBeenCalledTimes(1);

    keyNotify?.();
    await tick();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("hides the line and checks nothing while the service has no host", async () => {
    let hostValue = "h.test";
    const check = vi.fn(async (): Promise<ServerCheck | null> => ({ kind: "ok" }));
    const section = lineSection();
    const line = createServerLine({
      section,
      check,
      host: () => hostValue,
      watch: () => hostValue,
      subscribe: () => () => {},
      subscribeKey: () => () => {},
      isOpen: () => true,
    });
    const lineEl = section.querySelector<HTMLElement>(".yui-chat-status")!;

    line.run();
    await tick();
    expect(lineEl.hidden).toBe(false);

    hostValue = "";
    line.run();
    await tick();
    expect(lineEl.hidden).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
