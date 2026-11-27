/** Wires the Character menu into the pet window: a right-click on her opens it in the Character menu window, which sends her picks back here. */

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import type {
  CharacterMenu,
  MenuKind,
  MenuState,
  SettingsBridge,
} from "../../io/bridge/settings-bridge";
import { focusCurrentWindow } from "../../io/window/current-window";
import { logicalWorkArea, monitorAtLogical } from "../../io/window/geometry/screen-geometry";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import { isTauri } from "../../tauri-env";
import type { MenuActions } from "../../ui/character-menu/character-menu";
import type { wireLocomotion } from "../stage/wire-locomotion";

const log = createLogger("wire-character-menu");

/** How long the menu window gets to report shown, or closed after a close request. */
const REPLY_MS = 2000;

/** Returns the teardown. */
export function wireCharacterMenu(deps: {
  stage: HTMLElement;
  /** The pet window's UI layer, marked while her menu shows. */
  overlay: HTMLElement;
  /** This pet window's label. */
  label: string;
  kind: MenuKind;
  name: () => string;
  renderer: Pick<Renderer, "getTapPoints" | "getSilhouetteBounds">;
  locomotion: Pick<ReturnType<typeof wireLocomotion>, "hold" | "abortTravel" | "frame">;
  hitTest: () => HitTestKnobs;
  bridge: Pick<SettingsBridge, "emitCharacterMenu" | "onCharacterMenu">;
  ports: { read(): MenuState; actions: MenuActions };
}): () => void {
  const { overlay, locomotion, bridge, ports } = deps;
  let seq = 0;
  /** The open asked for and not yet reported closed. */
  let current: string | null = null;
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onEnd: (() => void) | null = null;

  const ours = (id: string): boolean => id.startsWith(`${deps.label}#`);

  function end(): void {
    clearTimeout(timer);
    overlay.removeAttribute("data-menu-open");
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

  async function readPlacement() {
    const win = locomotion.frame.frameWindow();
    const [pos, size, scale, monitors] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
      locomotion.frame.listMonitors(),
    ]);
    const frame = {
      x: pos.x / scale,
      y: pos.y / scale,
      width: size.width / scale,
      height: size.height / scale,
    };
    const monitor = monitorAtLogical(
      monitors,
      frame.x + frame.width / 2,
      frame.y + frame.height / 2,
    );
    if (!monitor) throw new Error("no monitor under her window");
    const tap = deps.renderer.getTapPoints();
    const silhouette = deps.renderer.getSilhouetteBounds();
    return {
      frame,
      workArea: logicalWorkArea(monitor),
      head: tap?.head?.y ?? frame.height * 0.4,
      nameTop: silhouette?.top ?? frame.height * 0.25,
      chest: tap?.chest ?? { x: frame.width / 2, y: frame.height / 2 },
    };
  }

  async function open(): Promise<void> {
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
        bridge.emitCharacterMenu({ type: "close", id });
        return untilClosed(id);
      },
    });
    try {
      // A cancelled stroll or climb may still be unparking its travel.
      await locomotion.abortTravel();
    } catch (err) {
      log.warn("abort_travel_failed", { error: String(err) });
    }
    let placement: Awaited<ReturnType<typeof readPlacement>>;
    try {
      placement = await readPlacement();
    } catch (err) {
      if (current === id) end();
      throw err;
    }
    if (current !== id) return;
    bridge.emitCharacterMenu({
      type: "open",
      id,
      from: deps.label,
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
    if (current && shown)
      bridge.emitCharacterMenu({ type: "state", id: current, state: ports.read() });
  }

  function onMessage(message: CharacterMenu): void {
    if (!ours(message.id)) return;
    if (message.type === "shown") {
      if (message.id !== current) {
        bridge.emitCharacterMenu({ type: "close", id: message.id });
        return;
      }
      shown = true;
      clearTimeout(timer);
      overlay.setAttribute("data-menu-open", "");
    } else if (message.type === "action") void run(message);
    else if (message.type === "closed" && message.id === current) {
      end();
      if (message.refocus)
        void focusCurrentWindow().catch((err) => log.warn("focus_failed", { error: String(err) }));
    }
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    // The press that closes her menu never reopens it.
    if (!isTauri() || current !== null) return;
    open().catch((err) => log.warn("open_failed", { error: String(err) }));
  }

  const offMenu = bridge.onCharacterMenu(onMessage);
  deps.stage.addEventListener("contextmenu", onContextMenu);
  return () => {
    deps.stage.removeEventListener("contextmenu", onContextMenu);
    offMenu();
    if (current) {
      bridge.emitCharacterMenu({ type: "close", id: current });
      end();
    }
  };
}
