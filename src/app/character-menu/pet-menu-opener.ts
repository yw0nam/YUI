/** A pet window's side of the Character menu: each open asked of the menu window while she is held, its picks run on her ports, its close letting her go. */

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import type { CharacterMenu, MenuKind, MenuState } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import type { MenuActions } from "../../ui/character-menu/character-menu";
import { MENU_OPEN_ATTR } from "../../ui/surfaces/interactive-overlay";
import type { wireLocomotion } from "../stage/wire-locomotion";
import type { MenuPlacementRead } from "./read-menu-placement";

const log = createLogger("pet-menu-opener");

/** How long the menu window gets to report shown, or closed after a close request. */
const REPLY_MS = 2000;

export function createPetMenuOpener(deps: {
  /** This pet window's label. */
  label: string;
  kind: MenuKind;
  name: () => string;
  hitTest: () => HitTestKnobs;
  /** The pet window's UI layer, marked while her menu shows. */
  overlay: HTMLElement;
  locomotion: Pick<ReturnType<typeof wireLocomotion>, "hold" | "abortTravel">;
  readPlacement: () => Promise<MenuPlacementRead>;
  ports: { read(): MenuState; actions: MenuActions };
  emit(message: CharacterMenu): void;
  focusWindow(): Promise<void>;
}): {
  /** Asks the menu window to open, unless an open of this window is pending or shown. */
  open(): Promise<void>;
  /** Takes the menu window's shown, action or closed report; other messages are ignored. */
  receive(message: CharacterMenu): void;
  /** Closes a pending or shown menu and lets her go. */
  dispose(): void;
} {
  const { overlay, locomotion, ports, emit } = deps;
  let seq = 0;
  /** The open asked for and not yet reported closed. */
  let current: string | null = null;
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onEnd: (() => void) | null = null;

  const ours = (id: string): boolean => id.startsWith(`${deps.label}#`);

  function end(): void {
    clearTimeout(timer);
    overlay.removeAttribute(MENU_OPEN_ATTR);
    locomotion.hold("menu", false);
    current = null;
    shown = false;
    onEnd?.();
    onEnd = null;
  }

  /** Settles once the menu reports `id` closed, or after the reply time, when she is let go anyway. */
  function untilClosed(id: string): Promise<void> {
    return new Promise((resolve) => {
      const wait = setTimeout(() => {
        if (current === id) end();
        resolve();
      }, REPLY_MS);
      onEnd = () => {
        clearTimeout(wait);
        resolve();
      };
    });
  }

  async function open(): Promise<void> {
    // The press that closes her menu never reopens it.
    if (current !== null) return;
    const id = `${deps.label}#${++seq}`;
    current = id;
    let sent = false;
    locomotion.hold("menu", true, {
      onAbort: () => {
        if (current !== id) return;
        if (!sent) {
          end();
          return;
        }
        emit({ type: "close", id });
        return untilClosed(id);
      },
    });
    try {
      // A cancelled stroll or climb may still be unparking its travel.
      await locomotion.abortTravel();
    } catch (err) {
      log.warn("abort_travel_failed", { error: String(err) });
    }
    let placement: MenuPlacementRead;
    try {
      placement = await deps.readPlacement();
    } catch (err) {
      if (current === id) end();
      throw err;
    }
    if (current !== id) return;
    emit({
      type: "open",
      id,
      kind: deps.kind,
      name: deps.name(),
      state: ports.read(),
      ...placement,
      hitTest: deps.hitTest(),
    });
    sent = true;
    timer = setTimeout(() => {
      if (current !== id || shown) return;
      end();
      log.warn("menu_open_timeout", { id });
    }, REPLY_MS);
  }

  async function run(message: Extract<CharacterMenu, { type: "action" }>): Promise<void> {
    try {
      // Each pick's value matches its action, as the bridge checked.
      await (ports.actions[message.action] as (value: unknown) => void | Promise<void>)(
        message.value,
      );
    } catch (err) {
      log.warn("action_failed", { action: message.action, error: String(err) });
    }
    if (current && shown) emit({ type: "state", id: current, state: ports.read() });
  }

  return {
    open,
    receive(message) {
      if (!ours(message.id)) return;
      if (message.type === "shown") {
        if (message.id !== current) {
          emit({ type: "close", id: message.id });
          return;
        }
        shown = true;
        clearTimeout(timer);
        overlay.setAttribute(MENU_OPEN_ATTR, "");
      } else if (message.type === "action") void run(message);
      else if (message.type === "closed" && message.id === current) {
        end();
        if (message.refocus)
          void deps.focusWindow().catch((err) => log.warn("focus_failed", { error: String(err) }));
      }
    },
    dispose() {
      if (!current) return;
      emit({ type: "close", id: current });
      end();
    },
  };
}
