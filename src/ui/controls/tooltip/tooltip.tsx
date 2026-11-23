/**
 * One tooltip shared by every trigger under a `TooltipHost`, on Base UI's Tooltip. A `Tip` composes
 * the trigger onto its child: hover opens after 150 ms, keyboard focus at once, a press closes it.
 * Focus opens a tip only after a focus-moving key, so a focus the code moves stays quiet.
 */

import { mergeProps } from "@base-ui/react/merge-props";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  cloneElement,
  createContext,
  type ReactElement,
  type ReactNode,
  type Ref,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import "./tooltip.css";

const TIP_ID = "yui-hint-tip";
const OPEN_DELAY_MS = 150;
const FOCUS_MOVING_KEYS = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

type Handle = ReturnType<typeof Tooltip.createHandle<string>>;

const HandleContext = createContext<{ handle: Handle; keyboard: { current: boolean } } | null>(
  null,
);

export interface TooltipHostHandle {
  close(): void;
}

export function TooltipHost({
  children,
  handle: ref,
}: {
  children: ReactNode;
  handle?: Ref<TooltipHostHandle>;
}) {
  const [handle] = useState(() => Tooltip.createHandle<string>());
  const keyboard = useRef(false);
  useImperativeHandle(ref, () => ({ close: () => handle.close() }), [handle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (FOCUS_MOVING_KEYS.has(e.key)) keyboard.current = true;
    };
    const onPointer = (): void => {
      keyboard.current = false;
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  return (
    <HandleContext.Provider value={{ handle, keyboard }}>
      {children}
      <Tooltip.Root
        handle={handle}
        disableHoverablePopup
        onOpenChange={(open, details) => {
          if (open && details.reason === "trigger-focus" && !keyboard.current) details.cancel();
        }}
      >
        {({ payload }) => (
          <Tooltip.Portal>
            <Tooltip.Positioner
              className="yui-hint-tip-pos"
              side="bottom"
              sideOffset={6}
              collisionPadding={8}
            >
              <Tooltip.Popup className="yui-hint-tip" id={TIP_ID} role="tooltip">
                {payload}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
    </HandleContext.Provider>
  );
}

/** Makes `children`, a button or a link, the trigger of a tip reading `text`; it keeps its own props and ref. */
export function Tip({ text, children }: { text: string; children: ReactElement<object> }) {
  const host = useContext(HandleContext);
  const id = useId();
  if (!host) return children;
  const { handle, keyboard } = host;
  const own = children.props as { ref?: Ref<HTMLButtonElement> };
  // After a focus-moving key, focus opens the tip even where the browser does not mark it :focus-visible.
  const onFocus = (): void => {
    if (keyboard.current) handle.open(id);
  };
  return (
    <Tooltip.Trigger
      id={id}
      handle={handle}
      payload={text}
      delay={OPEN_DELAY_MS}
      ref={own.ref}
      render={(props, state) =>
        cloneElement(
          children,
          mergeProps(own, props, {
            onFocus,
            "aria-describedby": state.open ? TIP_ID : undefined,
          }),
        )
      }
    />
  );
}
