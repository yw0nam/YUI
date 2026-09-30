/**
 * The phone's top row — the name plate and the delegation chip in one row inside the safe area,
 * the status pill centred beneath them. The plate follows the push socket's state, and the pill
 * is the Surfaces tool port. No dock, no drag, no capture segment, no settings openers: the
 * phone opens nothing of its own.
 */

import type { DelegationsStore } from "../../../io/bridge/delegations-store";
import type { PushSocket } from "../../../io/chat/push-socket";
import type { ToolStatus } from "../../../ui/chips/status-pill";
import { createStatusPill } from "../../../ui/chips/status-pill";
import type { VoiceInputStatus } from "../../../ui/chips/voice-input-status";
import { createMessagePlate, type MessagePlate } from "../../../ui/message/message-plate";
import { bindPlateConnection } from "../../../ui/message/plate-connection";
import { createDelegationChipMount } from "../../turn/wire-push";

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
  });
  const offConnection = bindPlateConnection(plate, deps.pushSocket);

  return {
    tool: pill,
    chip,
    plate,
    dispose(): void {
      offConnection();
      chip.dispose();
      pill.dispose();
      plate.dispose();
      head.remove();
    },
  };
}
