/** The quick card's rows: the Body and Reference voice selects, the reset that asks first, and Turn off. */

import { useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { Logger } from "../../logger";
import { t } from "../i18n";
import { useSnapshot } from "./use-snapshot";

/** A native select's options and the store it applies to at once. */
export interface PickerPort {
  options(): { id: string; label: string }[];
  current(): string;
  select(id: string): Promise<void>;
  subscribe(cb: () => void): () => void;
}

function PickerRow({ labelKey, port, log }: { labelKey: string; port: PickerPort; log: Logger }) {
  const options = useSnapshot(port.options, port.subscribe);
  const current = useSyncExternalStore(port.subscribe, port.current);
  // The choice shows until the apply settles, then the store's value again.
  const [chosen, setChosen] = useState<string | null>(null);
  // No voice set: the empty id reads None instead of a blank select.
  const shown = options.length > 0 ? options : [{ id: "", label: "" }];
  return (
    <label className="yui-qcard__row">
      <span>{t(labelKey)}</span>
      <select
        className="yui-qcard__select"
        value={chosen ?? current}
        onChange={(e) => {
          setChosen(e.target.value);
          void port
            .select(e.target.value)
            .catch((err) => log.warn("select_failed", { error: String(err) }))
            .finally(() => setChosen(null));
        }}
      >
        {shown.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id === "" ? t("quick_card.voice_none") : o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Rows({
  body,
  voice,
  resetConversation,
  turnOff,
  log,
}: {
  body: PickerPort;
  voice: PickerPort;
  resetConversation(): void;
  /** Null for main, which cannot be turned off. */
  turnOff: (() => void) | null;
  log: Logger;
}) {
  const [confirming, setConfirming] = useState(false);
  const resetRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Focus follows the button that stays visible, so Escape still reaches the card.
  function showConfirm(show: boolean): void {
    flushSync(() => setConfirming(show));
    (show ? cancelRef : resetRef).current?.focus();
  }
  return (
    <div className="yui-qcard__rows">
      <PickerRow labelKey="quick_card.body" port={body} log={log} />
      <PickerRow labelKey="quick_card.voice_ref" port={voice} log={log} />
      <div className="yui-qcard__row">
        <span>{t("quick_card.conversation")}</span>
        <button
          ref={resetRef}
          className="yui-qcard__reset"
          type="button"
          hidden={confirming}
          onClick={() => showConfirm(true)}
        >
          {t("quick_card.reset")}
        </button>
      </div>
      <div className="yui-qcard__confirm" hidden={!confirming}>
        <span className="yui-qcard__confirm-q">{t("quick_card.reset_confirm")}</span>
        <button
          ref={cancelRef}
          className="yui-qcard__pill yui-qcard__cancel"
          type="button"
          onClick={() => showConfirm(false)}
        >
          {t("quick_card.cancel")}
        </button>
        <button
          className="yui-qcard__pill yui-qcard__confirm-go"
          type="button"
          onClick={() => {
            resetConversation();
            showConfirm(false);
          }}
        >
          {t("quick_card.reset_go")}
        </button>
      </div>
      {turnOff && (
        <button className="yui-qcard__row yui-qcard__turnoff" type="button" onClick={turnOff}>
          {t("quick_card.turn_off")}
        </button>
      )}
    </div>
  );
}
