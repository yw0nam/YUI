/** A select on Base UI's Select: the caller labels it and owns the value; the popup lists the items. */

import { Select as BaseSelect } from "@base-ui/react/select";
import { useLayoutEffect, useRef, useState } from "react";
import "./select.css";

export interface SelectItem<V extends string> {
  value: V;
  label: string;
}

export interface SelectProps<V extends string> {
  id?: string;
  value: V;
  items: readonly SelectItem<V>[];
  onValueChange(value: V): void;
  disabled?: boolean;
  /** Extra classes beside `yui-select` on the trigger. */
  className?: string;
  "aria-label": string;
  /** The closed trigger's text, where it differs from the item's label in the popup. */
  valueLabel?: (value: V) => string;
}

export function Select<V extends string>({
  id,
  value,
  items,
  onValueChange,
  disabled,
  className,
  "aria-label": ariaLabel,
  valueLabel,
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // The popup sits outside the trigger's view, so a render that hides that view closes it.
  useLayoutEffect(() => {
    if (open && trigger.current?.closest("[hidden]")) setOpen(false);
  });

  return (
    <BaseSelect.Root
      open={open}
      onOpenChange={setOpen}
      value={value}
      items={items}
      onValueChange={(next) => {
        // A native select reports no change when its current option is picked again.
        if (next !== null && next !== value) onValueChange(next as V);
      }}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        ref={trigger}
        id={id}
        className={className ? `yui-select ${className}` : "yui-select"}
        aria-label={ariaLabel}
      >
        <BaseSelect.Value>
          {(current: V | null) =>
            current === null
              ? ""
              : (valueLabel?.(current) ?? items.find((item) => item.value === current)?.label)
          }
        </BaseSelect.Value>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="yui-select-pos">
          <BaseSelect.Popup className="yui-select-pop">
            <BaseSelect.List className="yui-select-list">
              {items.map((item) => (
                <BaseSelect.Item key={item.value} value={item.value} className="yui-select-item">
                  <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
