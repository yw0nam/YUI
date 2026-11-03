// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "../i18n";
import { createCommandReply } from "./command-reply";

let mount: HTMLElement;
let reply: ReturnType<typeof createCommandReply>;
beforeEach(() => {
  setLocale("en");
  mount = document.createElement("div");
  document.body.append(mount);
  reply = createCommandReply({ mount });
});
afterEach(() => {
  reply.dispose();
  mount.remove();
});
it("shows pending then settles with Markdown", () => {
  reply.pending("status");
  expect(mount.textContent).toContain("/status");
  expect(mount.textContent).toContain("Running");
  reply.settle("**Ready**");
  expect(mount.querySelector("strong")?.textContent).toBe("Ready");
  expect(mount.textContent).not.toContain("Running");
});
it("labels empty output", () => {
  reply.pending("status");
  reply.settle("");
  expect(mount.textContent).toContain("No output");
});
it("hides when closed", () => {
  reply.pending("status");
  mount.querySelector<HTMLButtonElement>('button[aria-label="Close reply"]')!.click();
  expect(mount.querySelector<HTMLElement>(".yui-cmd-reply")!.hidden).toBe(true);
});
