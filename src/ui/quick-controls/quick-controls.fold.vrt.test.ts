// A switched-off source group's fold, measured with the real stylesheets in WebKit: dim, yet editable.
import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../styles.css";
import "./settings-window.css";
import { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { createThreadReactionThresholdsSettings } from "../../settings/threads/thread-reaction-thresholds-settings";
import { createThreadTurnsSettings } from "../../settings/threads/thread-turns-settings";
import { setLocale } from "../i18n";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

beforeEach(async () => {
  setLocale("en");
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  await page.viewport(760, 680);
});

function build(extra: Partial<Parameters<typeof createQuickControls>[0]>) {
  const qc = createQuickControls({
    ...defaultQcArgs(document.querySelector<HTMLElement>("#app")!),
    ...extra,
  });
  qc.open({ page: "react" });
  return qc;
}

// The opacity a row shows within its page: the product up to the page panel (the panel's own fade-in is left out).
function shownOpacity(el: Element): number {
  let opacity = 1;
  for (let e: Element | null = el; e && !e.matches(".yui-tabpanel"); e = e.parentElement) {
    opacity *= Number(getComputedStyle(e).opacity);
  }
  return opacity;
}

it("takes a click on a field in a switched-off group's fold", () => {
  const qc = build({ agentNotifySettings: createAgentNotifySettings() });
  const input = qc.el.querySelector<HTMLInputElement>("#yui-agent-port")!;
  input.closest("details")!.open = true;
  input.scrollIntoView({ block: "center" });

  const box = input.getBoundingClientRect();
  expect(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)).toBe(input);
  qc.dispose();
});

it("dims the Threads rows but not Thread turns while only Thread reactions is off", () => {
  const agentNotifySettings = createAgentNotifySettings();
  agentNotifySettings.setEnabled(true);
  const qc = build({
    agentNotifySettings,
    threadTurnsSettings: createThreadTurnsSettings(),
    threadReactionsSettings: createFlagSettings(false),
    threadReactionThresholdsSettings: createThreadReactionThresholdsSettings(),
  });
  const row = (sel: string) => qc.el.querySelector(sel)!.closest(".yui-row")!;
  qc.el.querySelector<HTMLDetailsElement>(".yui-threadturns-row")!.closest("details")!.open = true;

  expect([
    shownOpacity(row(".yui-reaction-thresholds-count-seg")),
    shownOpacity(row(".yui-threadturns-seg")),
  ]).toEqual([0.5, 1]);
  qc.dispose();
});
