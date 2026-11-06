// @vitest-environment jsdom
/** wire-turns-menu.test.ts — the Character turns menu over the Thread turns and External signals stores. */

import { expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import { createThreadTurnsSettings } from "../../settings/threads/thread-turns-settings";
import { setLocale } from "../../ui/i18n";
import { createTurnsMenu } from "../../ui/threads/window/turns-menu";
import { wireTurnsMenu } from "./wire-turns-menu";

it("draws a local pick from the store, tells the other windows, and follows External signals", () => {
  setLocale("en");
  const turns = createThreadTurnsSettings();
  const agentNotify = createAgentNotifySettings();
  agentNotify.setEnabled(true);
  const emitSettingsChanged = vi.fn();
  const menu = createTurnsMenu({ onPick: (level) => control.pick(level) });
  document.body.append(menu.el);
  const control = wireTurnsMenu({ turns, agentNotify, show: menu.set, emitSettingsChanged });
  const button = document.querySelector<HTMLButtonElement>(".yui-threads__turns-button")!;
  const radio = (name: string) =>
    document.querySelector<HTMLButtonElement>(`[role="radio"][data-level="${name}"]`)!;
  expect(button.textContent).toBe("Character turns: Off");

  button.click();
  radio("notable").click();

  expect(turns.get().level).toBe("notable");
  expect(emitSettingsChanged).toHaveBeenCalledOnce();
  expect(button.textContent).toBe("Character turns: When it needs me");
  expect(radio("notable").getAttribute("aria-checked")).toBe("true");
  expect(radio("off").getAttribute("aria-checked")).toBe("false");

  agentNotify.setEnabled(false);
  expect(radio("notable").disabled).toBe(true);
});
