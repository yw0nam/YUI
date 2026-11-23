/**
 * The chat model field on Base UI's Autocomplete: the server's model ids filter beneath it while
 * it holds focus. A pick commits at once; typed text commits on blur or on Enter with no item
 * highlighted.
 */

import { Autocomplete } from "@base-ui/react/autocomplete";
import { useRef, useState } from "react";
import { t } from "../../../i18n";
import { isCommitEnter } from "../detail/endpoint-row";
import "./model-field.css";

export function ModelField({
  value,
  ids,
  disabled,
  placeholder,
  labelId,
  onType,
  onCommit,
  onBlur,
}: {
  value: string;
  /** The server's model ids; none keeps the popup shut. */
  ids: readonly string[];
  disabled: boolean;
  placeholder?: string;
  /** The model row's label, which names the listbox too. */
  labelId: string;
  onType(value: string): void;
  onCommit(value: string): void;
  onBlur(): void;
}) {
  const [open, setOpen] = useState(false);
  const highlighted = useRef<string | undefined>(undefined);
  const shown = open && ids.length > 0;

  return (
    <Autocomplete.Root
      items={ids}
      open={shown}
      onOpenChange={setOpen}
      value={value}
      onValueChange={(next, details) => {
        // Base UI clears the text on an Escape with the list shut; the panel's Escape takes it instead.
        if (details.reason === "escape-key" && !shown) {
          details.cancel();
          return;
        }
        if (details.reason === "item-press") onCommit(next);
        else onType(next);
      }}
      onItemHighlighted={(id) => {
        highlighted.current = id;
      }}
      disabled={disabled}
    >
      <Autocomplete.Input
        className="yui-ep-input"
        id="yui-ep-chat_model"
        spellCheck={false}
        autoCapitalize="off"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (isCommitEnter(e) && highlighted.current === undefined) {
            onCommit(e.currentTarget.value);
          }
        }}
        onBlur={onBlur}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="yui-model-pos" align="start" sideOffset={4}>
          <Autocomplete.Popup className="yui-model-list">
            <Autocomplete.Empty className="yui-model-list__none">
              {t("svc.chat_models_no_match")}
            </Autocomplete.Empty>
            <Autocomplete.List aria-labelledby={labelId}>
              {(id: string) => (
                <Autocomplete.Item key={id} value={id} className="yui-model-list__opt">
                  {id}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
