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

const WAITING_DECLARATION = `  waiting: {
    /** What the character has not spoken to yet: one short row per waiting entry and buffered signal group (id, kind, label, local clock, minutes waited). */
    list(): Promise<string[]>;
    /** One row from list() in full, by its id. */
    read(id: string): Promise<unknown>;
  };`;

const pad = (value: number): string => String(value).padStart(2, "0");

/** Local wall-clock `HH:MM`. */
function clockOf(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The whole minutes since `at`, never negative. */
function minutesSince(at: number, now: number): number {
  return Math.max(0, Math.round((now - at) / 60_000));
}

/** One row: `w3 schedule "Lunch" 12:00 local, 40min`, with a signal's label unquoted. */
function rowOf(item: WaitingItem, now: number): string {
  const label =
    item.label === undefined ? "" : item.kind === "signal" ? ` ${item.label}` : ` "${item.label}"`;
  return `${item.id} ${item.kind}${label} ${clockOf(item.at)} local, ${minutesSince(item.at, now)}min`;
}

export function createWaitingApi(port: { waiting(): WaitingItem[] }): YuiNamespace {
  const list: YuiMethod = async () => {
    const now = Date.now();
    return port.waiting().map((item) => rowOf(item, now));
  };

  const read: YuiMethod = async (_signal, id) => {
    if (typeof id !== "string" || id.length === 0)
      throw new TypeError("yui.waiting.read: id must be a non-empty string");
    const item = port.waiting().find((candidate) => candidate.id === id);
    return item ? item.detail : `error: unknown waiting item: ${id}`;
  };

  return { methods: { list, read }, declaration: WAITING_DECLARATION };
}
