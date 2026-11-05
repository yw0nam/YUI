/**
 * One server line's lifecycle: check on run, render the answer, re-check when the watched fields
 * or the service's key change, and drop whatever a newer run superseded.
 */

import type { ServerCheck } from "../../../../io/chat/models/server-check";
import { createChatStatus } from "../chat/chat-status";
import { serverLineView } from "./server-line-view";

export function createServerLine(deps: {
  /** Holds one .yui-chat-status line. */
  section: HTMLElement;
  /** Asks the server; null says there is nothing to check — the line hides. */
  check: () => Promise<ServerCheck | null>;
  /** The host the line names; "" hides the line and skips the check. */
  host: () => string;
  /** The fields whose change re-checks, as one comparable string. */
  watch: () => string;
  /** The endpoints store — re-checks only when watch() changed. */
  subscribe: (cb: () => void) => () => void;
  /** The service's key store — re-checks on every notify. */
  subscribeKey: (cb: () => void) => () => void;
  /** The panel's open state; notifications read nothing while it is closed. */
  isOpen: () => boolean;
}): { run(): void; dispose(): void } {
  const status = createChatStatus(deps.section, { onAction: run });

  let seq = 0;
  let watched = "";

  async function run(): Promise<void> {
    const mine = ++seq;
    watched = deps.watch();
    const host = deps.host();
    if (host === "") {
      status.renderView(null);
      return;
    }
    status.renderView(serverLineView("checking", host));
    const result = await deps.check();
    if (mine !== seq) return;
    status.renderView(result === null ? null : serverLineView(result, host));
  }

  const unsubscribe = deps.subscribe(() => {
    if (deps.isOpen() && deps.watch() !== watched) void run();
  });
  const unsubscribeKey = deps.subscribeKey(() => {
    if (deps.isOpen()) void run();
  });

  return {
    run,
    dispose(): void {
      unsubscribe();
      unsubscribeKey();
      status.dispose();
      seq += 1;
    },
  };
}
