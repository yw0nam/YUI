// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { createCommandReply } from "./command-reply";

const onClose = vi.fn();
let mount: HTMLElement;
let reply: ReturnType<typeof createCommandReply>;
beforeEach(() => {
  setLocale("en");
  mount = document.createElement("div");
  document.body.append(mount);
  reply = createCommandReply({ mount });
  reply.onClose(onClose);
});
afterEach(() => {
  reply.dispose();
  mount.remove();
});
it("renders pending, settled, clear and a settled re-show", () => {
  reply.show({ kind: "pending", name: "status" });
  expect(mount.textContent).toContain("/status");
  expect(mount.textContent).toContain("Running");
  reply.show({ kind: "settled", name: "status", text: "**Ready**" });
  expect(mount.querySelector("strong")?.textContent).toBe("Ready");
  expect(mount.textContent).not.toContain("Running");
  reply.show({ kind: "clear" });
  expect(mount.querySelector<HTMLElement>(".yui-cmd-reply")!.hidden).toBe(true);
  reply.show({ kind: "settled", name: "model", text: "**Changed**" });
  expect(mount.querySelector<HTMLElement>(".yui-cmd-reply")!.hidden).toBe(false);
  expect(mount.textContent).toContain("/model");
  expect(mount.querySelector("strong")?.textContent).toBe("Changed");
});
it("labels empty output", () => {
  reply.show({ kind: "pending", name: "status" });
  reply.show({ kind: "settled", name: "status", text: "" });
  expect(mount.textContent).toContain("No output");
});
it("requests a close through the surfaces", () => {
  reply.show({ kind: "pending", name: "status" });
  mount.querySelector<HTMLButtonElement>('button[aria-label="Close reply"]')!.click();
  expect(onClose).toHaveBeenCalledOnce();
});

it("marks the reply body while more of it sits below its visible part", () => {
  reply.show({ kind: "settled", name: "status", text: "a\n\nb\n\nc" });
  const body = mount.querySelector<HTMLElement>(".yui-cmd-reply__body")!;
  Object.defineProperties(body, { scrollHeight: { value: 300 }, clientHeight: { value: 100 } });
  const scrollTo = (top: number) => {
    body.scrollTop = top;
    body.dispatchEvent(new Event("scroll"));
    return body.classList.contains("is-clipped");
  };

  expect([scrollTo(0), scrollTo(200)]).toEqual([true, false]);
});
