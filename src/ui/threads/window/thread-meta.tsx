/** The source line and the state a list row, a rail item and the thread pane lead with. */

import "./thread-meta.css";
import type { Thread } from "../../../contract";
import { t } from "../../i18n";
import { threadSource } from "../thread-source";

/** A Thread's state in words. */
export function stateText(thread: Thread): string {
  return t(`threads.state_${thread.state.replace("-", "_")}`);
}

/** The state word a row and the pane show. */
export function StateWord({ thread }: { thread: Thread }) {
  const read = thread.state === "input-required" && thread.read === true;
  return (
    <span className={read ? "yui-threads-state" : `yui-threads-state is-${thread.state}`}>
      {stateText(thread)}
    </span>
  );
}

/** The source mark and name a row and the pane lead with. */
export function SourceLine({ source }: { source: string }) {
  const { name, mark } = threadSource(source);
  return (
    <span className="yui-threads-source">
      <span className="yui-threads-source__mark" aria-hidden="true">
        {mark}
      </span>
      <span className="yui-threads-source__name">{name}</span>
    </span>
  );
}
