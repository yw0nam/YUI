/** The Threads window head's Thread turns button: it opens a popover of the three levels. */

import "./turns-menu.css";
import { Popover } from "@base-ui/react/popover";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { type Ref, useImperativeHandle, useRef, useState } from "react";
import {
  THREAD_TURNS,
  type ThreadTurnsLevel,
} from "../../../settings/threads/thread-turns-settings";
import { t } from "../../i18n";

const CAPTION_ID = "yui-threads-turns-caption";

export interface TurnsState {
  level: ThreadTurnsLevel;
  /** External signals is off, so no Thread reaches the main window. */
  disabled: boolean;
}

export interface TurnsHandle {
  set(state: TurnsState): void;
  isOpen(): boolean;
  close(): void;
}

export function TurnsMenu({
  onPick,
  handle,
}: {
  onPick(level: ThreadTurnsLevel): void;
  handle: Ref<TurnsHandle>;
}) {
  const [state, setState] = useState<TurnsState>({ level: "off", disabled: false });
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const show = (next: boolean): void => {
    isOpen.current = next;
    setOpen(next);
  };
  useImperativeHandle(handle, () => ({
    set: setState,
    isOpen: () => isOpen.current,
    close: () => show(false),
  }));

  return (
    <div ref={wrap} className="yui-threads__turns">
      <Popover.Root open={open} onOpenChange={show}>
        <Popover.Trigger
          className={
            state.level === "off" ? "yui-threads__turns-button" : "yui-threads__turns-button is-on"
          }
        >
          <svg className="yui-threads-glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
            <path d="M10 20.5a2 2 0 0 0 4 0" />
          </svg>
          <span className="yui-threads__turns-label">
            {t("threads.turns_button", { level: t(`threadTurns.${state.level}`) })}
          </span>
        </Popover.Trigger>
        {/* Inside the head's turns slot, so it stacks over the list overlay and under the panel's edge. */}
        <Popover.Portal container={wrap}>
          <Popover.Positioner
            className="yui-threads__turns-pos"
            side="bottom"
            align="end"
            sideOffset={6}
          >
            {/* A press inside the popover is not the head's window drag. */}
            <Popover.Popup
              className="yui-threads__turns-pop"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <p className="yui-threads__turns-caption" id={CAPTION_ID}>
                {t("threads.turns_caption")}
              </p>
              <RadioGroup
                aria-labelledby={CAPTION_ID}
                value={state.level}
                disabled={state.disabled}
              >
                {THREAD_TURNS.map((level) => (
                  <Radio.Root
                    key={level}
                    value={level}
                    nativeButton
                    render={
                      <button
                        type="button"
                        className="yui-threads__turns-radio"
                        data-level={level}
                      />
                    }
                    // The checked row reports no change, so a pick hangs on the activation.
                    onClick={() => {
                      onPick(level);
                      show(false);
                    }}
                  >
                    <span className="yui-threads__turns-tick" aria-hidden="true" />
                    <span className="yui-threads__turns-text">
                      <span>{t(`threadTurns.${level}`)}</span>
                      <span>{t(`threads.turns_${level}_sub`)}</span>
                    </span>
                  </Radio.Root>
                ))}
              </RadioGroup>
              <p className="yui-threads__turns-note">
                {t(state.disabled ? "threadTurns.disabled_reason" : "threads.turns_note")}
              </p>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
