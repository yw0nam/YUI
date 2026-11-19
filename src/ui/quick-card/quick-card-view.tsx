/** What fills the quick card: the head over the Quiet group, tiles, Threads buttons, rows and All settings…. */

import type { Logger } from "../../logger";
import { t } from "../i18n";
import { Head } from "./head";
import type { QuickCardDeps } from "./quick-card";
import { QuietGroup } from "./quiet-group";
import { Rows } from "./rows";
import { ThreadsButtons } from "./threads-buttons";
import { Tiles } from "./tiles";
import { useLocale } from "./use-locale";

export function QuickCardView({
  deps,
  log,
  close,
  onHeadPointerDown,
}: {
  deps: QuickCardDeps;
  log: Logger;
  close(): void;
  onHeadPointerDown(event: PointerEvent): void;
}) {
  useLocale();
  return (
    <>
      <Head deps={deps} close={close} onPointerDown={onHeadPointerDown} />
      <div className="yui-qcard__body">
        <QuietGroup dnd={deps.dnd} log={log} />
        <Tiles rows={deps.tiles} listen={deps.listen} log={log} />
        <ThreadsButtons
          open={(tab) => {
            deps.openThreads(tab);
            close();
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
                  close();
                }
              : null
          }
          log={log}
        />
        <button
          className="yui-qcard__all"
          type="button"
          onClick={() => {
            deps.openAllSettings();
            close();
          }}
        >
          {t("quick_card.all_settings")}
        </button>
      </div>
    </>
  );
}
