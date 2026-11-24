// @vitest-environment jsdom
/** wire-turns-menu.test.tsx — the Thread turns menu over the Thread turns and External signals stores. */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import { createThreadTurnsSettings } from "../../settings/threads/thread-turns-settings";
import { setLocale } from "../../ui/i18n";
import { type TurnsHandle, TurnsMenu } from "../../ui/threads/window/turns-menu";
import { wireTurnsMenu } from "./wire-turns-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => cleanup());
});

it("draws a local pick from the store, tells the other windows, and follows External signals", async () => {
  setLocale("en");
  const turns = createThreadTurnsSettings();
  const agentNotify = createAgentNotifySettings();
  agentNotify.setEnabled(true);
  const emitSettingsChanged = vi.fn();
  const control = wireTurnsMenu({ turns, agentNotify, emitSettingsChanged });
  const menu = createRef<TurnsHandle>();
  render(<TurnsMenu onPick={control.pick} handle={menu} />);
  act(() => {
    control.draw(menu.current!.set);
  });
  const button = document.querySelector<HTMLButtonElement>(".yui-threads__turns-button")!;
  const radio = (name: string) =>
    document.querySelector<HTMLButtonElement>(`[role="radio"][data-level="${name}"]`)!;
  const open = () =>
    act(async () => {
      fireEvent.click(button);
    });
  expect(button.textContent).toBe("Thread turns: Off");

  await open();
  await act(async () => {
    fireEvent.click(radio("notable"));
  });

  expect(turns.get().level).toBe("notable");
  expect(emitSettingsChanged).toHaveBeenCalledOnce();
  expect(button.textContent).toBe("Thread turns: When it needs her");
  await open();
  expect(radio("notable").getAttribute("aria-checked")).toBe("true");
  expect(radio("off").getAttribute("aria-checked")).toBe("false");

  act(() => agentNotify.setEnabled(false));
  expect(radio("notable").disabled).toBe(true);
});
