/** The quick card's contents: its head, Quiet group, tiles, Threads buttons and rows. */

import { createEffect } from "solid-js";
import type { Logger } from "../../logger";
import { CROSS_SVG } from "../quick-controls/constants";
import { avatarEl } from "../unified/avatar";
import { fromExternal } from "./external";
import { localized, tr } from "./locale";
import type { QuickCardDeps } from "./quick-card";
import { QuietGroup } from "./quiet-group";
import { Rows } from "./rows";
import { ThreadsButtons } from "./threads-buttons";
import { Tiles } from "./tiles";
import { transportLine } from "./transport-line";

export function CardView(props: {
  deps: QuickCardDeps;
  log: Logger;
  close(): void;
  onHeadPointerDown(event: PointerEvent): void;
  /** Whether the reset asks to be confirmed. */
  confirming: boolean;
  setConfirming(on: boolean): void;
}) {
  const { deps } = props;
  const entry = fromExternal(deps.entry, deps.subscribeEntry);
  const transport = fromExternal(deps.transport, deps.onTransport);
  // The vanilla avatar mounts into a host the framework owns, and swaps when the entry changes.
  let face!: HTMLElement;
  createEffect(entry, (e) => face.replaceChildren(avatarEl(e, 30)));
  return (
    <>
      <div
        class="yui-qcard__head"
        // The head drags the window; its × keeps its click.
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          props.onHeadPointerDown(event);
        }}
      >
        <span class="yui-qcard__face" ref={face} />
        <span class="yui-qcard__id">
          <span class="yui-qcard__name" id="yui-qcard-name">
            {entry().name}
          </span>
          <span class="yui-qcard__transport">{localized(() => transportLine(transport()))}</span>
        </span>
        <button
          class="yui-qcard__close"
          type="button"
          aria-label={tr("quick_card.close")}
          innerHTML={CROSS_SVG}
          onClick={() => props.close()}
        />
      </div>
      <div class="yui-qcard__body">
        <QuietGroup dnd={deps.dnd} log={props.log} />
        <Tiles rows={deps.tiles} listen={deps.listen} log={props.log} />
        <ThreadsButtons
          open={(tab) => {
            deps.openThreads(tab);
            props.close();
          }}
        />
        <Rows
          body={deps.body}
          voice={deps.voice}
          resetConversation={deps.resetConversation}
          turnOff={
            deps.turnOff
              ? () => {
                  deps.turnOff?.();
                  props.close();
                }
              : null
          }
          confirming={props.confirming}
          setConfirming={props.setConfirming}
          log={props.log}
        />
        <button
          class="yui-qcard__all"
          type="button"
          onClick={() => {
            deps.openAllSettings();
            props.close();
          }}
        >
          {tr("quick_card.all_settings")}
        </button>
      </div>
    </>
  );
}
