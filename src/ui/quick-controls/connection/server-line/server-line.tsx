/**
 * One server line: checks on run, shows the answer, checks again when the watched fields or the
 * service's key change, and drops whatever a newer run superseded.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import type { ServerCheck } from "../../../../io/chat/models/server-check";
import { StatusLine } from "../chat/chat-status";
import type { StatusView } from "../chat/model-status";
import { serverLineView } from "./server-line-view";

/** The line's run, which the page calls when Detailed settings is entered. */
export interface ServerLineRun {
  current: (() => void) | null;
}

export function ServerLine(props: {
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
  run: ServerLineRun;
}) {
  const [view, setView] = useState<StatusView | null>(null);
  // The line keeps the getters and subscriptions it mounted with.
  const [line] = useState(() => {
    const { check, host, watch, subscribe, subscribeKey, isOpen } = props;
    let seq = 0;
    let watched = "";
    async function run(): Promise<void> {
      const mine = ++seq;
      watched = watch();
      const name = host();
      if (name === "") {
        setView(null);
        return;
      }
      setView(serverLineView("checking", name));
      const result = await check();
      if (mine !== seq) return;
      setView(result === null ? null : serverLineView(result, name));
    }
    return {
      run,
      bind(): () => void {
        const off = subscribe(() => {
          if (isOpen() && watch() !== watched) void run();
        });
        const offKey = subscribeKey(() => {
          if (isOpen()) void run();
        });
        return () => {
          off();
          offKey();
          // A check still in flight lands nowhere.
          seq += 1;
        };
      },
    };
  });
  const { run } = props;

  useLayoutEffect(() => {
    run.current = () => void line.run();
    return () => {
      run.current = null;
    };
  }, [run, line]);

  useEffect(() => line.bind(), [line]);

  return <StatusLine view={view} onAction={() => void line.run()} />;
}
