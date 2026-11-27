/** yui.waiting: what the character has not spoken to yet, as short rows. */

import type { YuiMethod, YuiNamespace } from "./namespace";

/** One waiting row the window's wiring builds from the dispatcher's list and the signal buffers. */
export interface WaitingItem {
  id: string;
  kind: string;
  label?: string;
  /** Epoch ms the item came up. */
  at: number;
  /** What read(id) answers: the projected waiting item, or the signal group. */
  detail: unknown;
}

const WAITING_DECLARATION = "";

export function createWaitingApi(port: { waiting(): WaitingItem[] }): YuiNamespace {
  const list: YuiMethod = async () => port.waiting().map((item) => `${item.id} ${item.kind}`);
  const read: YuiMethod = async () => "error: not implemented";
  return { methods: { list, read }, declaration: WAITING_DECLARATION };
}
