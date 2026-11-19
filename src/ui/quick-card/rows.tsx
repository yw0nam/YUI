/** The quick card's rows: the Body and Reference voice selects, the reset that asks first, and Turn off. */

import { For, onSettled, Show } from "solid-js";
import type { Logger } from "../../logger";
import { fromExternal } from "./external";
import { tr } from "./locale";

/** A native select's options and the store it applies to at once. */
export interface PickerPort {
  options(): { id: string; label: string }[];
  current(): string;
  select(id: string): Promise<void>;
  subscribe(cb: () => void): () => void;
}

// No voice set: the empty id reads None instead of a blank select.
const NO_OPTIONS = [{ id: "", label: "" }];

function Picker(props: { labelKey: string; port: PickerPort; log: Logger }) {
  const { port, log } = props;
  const options = fromExternal(port.options, port.subscribe);
  const current = fromExternal(port.current, port.subscribe);
  let select!: HTMLSelectElement;
  return (
    <label class="yui-qcard__row">
      <span>{tr(props.labelKey)}</span>
      <select
        class="yui-qcard__select"
        ref={select}
        onChange={() => {
          void port
            .select(select.value)
            .catch((err) => log.warn("select_failed", { error: String(err) }))
            // A swap that did not happen leaves the select on the store's value.
            .finally(() => {
              select.value = port.current();
            });
        }}
      >
        <For each={options().length > 0 ? options() : NO_OPTIONS}>
          {(o) => (
            <option value={o.id} selected={o.id === current()}>
              {o.id === "" ? tr("quick_card.voice_none") : o.label}
            </option>
          )}
        </For>
      </select>
    </label>
  );
}

export function Rows(props: {
  body: PickerPort;
  voice: PickerPort;
  resetConversation(): void;
  /** Null for main, which cannot be turned off. */
  turnOff: (() => void) | null;
  /** Whether the reset is asking to be confirmed; the card disarms it on close. */
  confirming: boolean;
  setConfirming(on: boolean): void;
  log: Logger;
}) {
  let resetBtn!: HTMLButtonElement;
  let cancelBtn!: HTMLButtonElement;
  // Focus follows the button that stays visible, so Escape still reaches the card.
  const showConfirm = (show: boolean): void => {
    props.setConfirming(show);
    onSettled(() => (show ? cancelBtn : resetBtn).focus());
  };
  return (
    <div class="yui-qcard__rows">
      <Picker labelKey="quick_card.body" port={props.body} log={props.log} />
      <Picker labelKey="quick_card.voice_ref" port={props.voice} log={props.log} />
      <div class="yui-qcard__row">
        <span>{tr("quick_card.conversation")}</span>
        <button
          class="yui-qcard__reset"
          type="button"
          ref={resetBtn}
          hidden={props.confirming}
          onClick={() => showConfirm(true)}
        >
          {tr("quick_card.reset")}
        </button>
      </div>
      <div class="yui-qcard__confirm" hidden={!props.confirming}>
        <span class="yui-qcard__confirm-q">{tr("quick_card.reset_confirm")}</span>
        <button
          class="yui-qcard__pill yui-qcard__cancel"
          type="button"
          ref={cancelBtn}
          onClick={() => showConfirm(false)}
        >
          {tr("quick_card.cancel")}
        </button>
        <button
          class="yui-qcard__pill yui-qcard__confirm-go"
          type="button"
          onClick={() => {
            props.resetConversation();
            showConfirm(false);
          }}
        >
          {tr("quick_card.reset_go")}
        </button>
      </div>
      <Show when={props.turnOff}>
        <button
          class="yui-qcard__row yui-qcard__turnoff"
          type="button"
          onClick={() => props.turnOff?.()}
        >
          {tr("quick_card.turn_off")}
        </button>
      </Show>
    </div>
  );
}
