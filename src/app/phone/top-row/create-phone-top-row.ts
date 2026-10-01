/**
 * The phone's top row — the name plate, the delegation chip and the view openers in one row
 * inside the safe area, the status pill centred beneath them. The plate follows the push
 * socket's state, the pill is the Surfaces tool port, and the openers summon the phone's
 * settings/history view. No dock, no drag, no capture segment.
 */

import type { DelegationsStore } from "../../../io/bridge/delegations-store";
import type { PushSocket } from "../../../io/chat/push-socket";
import type { ToolStatus } from "../../../ui/chips/status-pill";
import { createStatusPill } from "../../../ui/chips/status-pill";
import type { VoiceInputStatus } from "../../../ui/chips/voice-input-status";
import { t } from "../../../ui/i18n";
import { createMessagePlate, type MessagePlate } from "../../../ui/message/message-plate";
import { bindPlateConnection } from "../../../ui/message/plate-connection";
import type { PhoneSettingsTab } from "../../../ui/phone/settings/phone-settings-view";
import { createDelegationChipMount } from "../../turn/wire-push";

const HISTORY_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v4l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.5 17v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SETTINGS_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="6" r="1.7" fill="var(--yui-scrim-strong)" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="12" r="1.7" fill="var(--yui-scrim-strong)" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="18" r="1.7" fill="var(--yui-scrim-strong)" stroke="currentColor" stroke-width="1.5"/></svg>`;

export interface PhoneTopRow {
  /** The status pill, as the Surfaces tool port. */
  tool: ToolStatus;
  /** The delegation chip's lazy mount, as wirePushMode's chip seam. */
  chip: { create(): void; dispose(): void };
  plate: MessagePlate;
  dispose(): void;
}

export function createPhoneTopRow(deps: {
  mount: HTMLElement;
  voice: VoiceInputStatus;
  pushSocket: PushSocket;
  delegations: DelegationsStore;
  /** Opens the phone's settings/history view — the buttons and the chip's lost-state tap. */
  onOpenView: (tab: PhoneSettingsTab) => void;
}): PhoneTopRow {
  const head = document.createElement("div");
  head.className = "yui-phone__head";
  deps.mount.appendChild(head);
  const row = document.createElement("div");
  row.className = "yui-phone__top";
  head.appendChild(row);

  const plate = createMessagePlate({ mount: row });
  const pill = createStatusPill({ mount: head, voice: deps.voice });
  const chip = createDelegationChipMount({
    mount: row,
    store: deps.delegations,
    pushState: deps.pushSocket,
    onOpenSettings: () => deps.onOpenView("conn"),
  });
  const offConnection = bindPlateConnection(plate, deps.pushSocket);

  // View openers sit right of a flex spacer; the head passes pointers through, so the
  // buttons carry their own targets.
  const spacer = document.createElement("span");
  spacer.className = "yui-phone__spacer";
  row.appendChild(spacer);
  const openBtns: HTMLButtonElement[] = [];
  const openHandlers: (() => void)[] = [];
  for (const [tab, label, icon] of [
    ["hist", t("phone.open_history"), HISTORY_SVG],
    ["conn", t("phone.open_settings"), SETTINGS_SVG],
  ] as const) {
    const handler = (): void => deps.onOpenView(tab);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "yui-phone__open";
    btn.setAttribute("aria-label", label);
    btn.innerHTML = `<span aria-hidden="true">${icon}</span>`;
    btn.addEventListener("click", handler);
    row.appendChild(btn);
    openBtns.push(btn);
    openHandlers.push(handler);
  }

  return {
    tool: pill,
    chip,
    plate,
    dispose(): void {
      offConnection();
      chip.dispose();
      pill.dispose();
      plate.dispose();
      openBtns.forEach((btn, i) => {
        btn.removeEventListener("click", openHandlers[i]);
      });
      head.remove();
    },
  };
}
