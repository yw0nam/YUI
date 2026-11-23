/** The Persona page: its view, the card's file actions and drop, and the redraw the open hook runs. */

import { createElement, type ReactNode, type RefObject, useEffect } from "react";
import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { SubscribeFileDrop } from "../../../io/window/file-drop/file-drop";
import type { Logger } from "../../../logger";
import type { ActiveHoursSettingsStore } from "../../../settings/active-hours/active-hours-settings";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import type { createEndpointsSettings } from "../../../settings/backend/endpoints-settings";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import type { createFillerSettings } from "../../../settings/voice/filler-settings";
import { subscribe as subscribeLocale } from "../../i18n";
import { createPageRevision } from "../page-revision";
import { createCardDrop } from "./card/card-drop";
import { currentCard, presetEntry } from "./card/card-entry";
import type { CardIoPorts } from "./card/card-io";
import { createCardIo } from "./card/card-io";
import { PersonaPageView } from "./persona-page-view";

export interface PersonaPage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
  /** Repaints the page from its stores and the edit's own card — the open hook. */
  reflect(): void;
}

/** While mounted: the drop cover, and the stores that repaint the page while the panel is open. */
function PersonaSources({
  subscribes,
  drop,
  children,
}: {
  subscribes: readonly ((() => () => void) | undefined)[];
  drop?: () => { dispose(): void } | undefined;
  children?: ReactNode;
}) {
  useEffect(() => {
    const offs = subscribes.map((subscribe) => subscribe?.());
    return () => {
      for (const off of offs) off?.();
    };
  }, [subscribes]);
  useEffect(() => {
    const cover = drop?.();
    return () => cover?.dispose();
  }, [drop]);
  return children;
}

export function createPersonaPage(deps: {
  /** The panel-wide host the drop cover fills, set once the panel renders. */
  dropHost: RefObject<HTMLElement | null>;
  /** Per-character active hours; absent where the window edits no character. */
  activeHoursSettings?: ActiveHoursSettingsStore;
  agentSettings: ReturnType<typeof createAgentSettings>;
  endpointsSettings: Pick<ReturnType<typeof createEndpointsSettings>, "subscribe">;
  /** Filler pools the card export carries. */
  fillerSettings: Pick<ReturnType<typeof createFillerSettings>, "get">;
  /** Renames the preset; absent where the panel shows no preset strip. */
  registry?: Pick<PresetRegistry, "rename" | "subscribe">;
  /** The bundled config's default cards and fallback words; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  /** Whether push chat is the effective mode; on push only the card's file actions stay enabled. */
  isPushMode: () => boolean;
  /** Store subscriptions redraw only while the panel is open. */
  isOpen: () => boolean;
  vrmSelection: Parameters<typeof PersonaPageView>[0]["vrmSelection"];
  speakerSelection: Parameters<typeof PersonaPageView>[0]["speakerSelection"];
  /** Card file steps, wired by the app layer. */
  importPreset: CardIoPorts["importPreset"];
  importDroppedPreset: CardIoPorts["importDroppedPreset"];
  importBusy: CardIoPorts["importBusy"];
  exportPresetFile: CardIoPorts["exportPresetFile"];
  exportCardPng: CardIoPorts["exportCardPng"];
  inspectPresetVrm: CardIoPorts["inspectPresetVrm"];
  /** This window's file drag events; absent outside Tauri, and then no drop cover. */
  subscribeFileDrop?: SubscribeFileDrop;
  log: Logger;
}): PersonaPage {
  const { agentSettings, endpointsSettings, registry, isOpen } = deps;
  const io = createCardIo({
    ports: {
      importPreset: deps.importPreset,
      importDroppedPreset: deps.importDroppedPreset,
      importBusy: deps.importBusy,
      exportPresetFile: deps.exportPresetFile,
      exportCardPng: deps.exportCardPng,
    },
    currentCard: () => currentCard(agentSettings, deps.getPersona),
    entry: presetEntry,
    fillerPools: () => deps.fillerSettings.get().customPools,
    activeHoursSpans: () => deps.activeHoursSettings?.get().spans ?? null,
    log: deps.log,
  });
  const { subscribeFileDrop } = deps;
  const drop =
    subscribeFileDrop &&
    (() =>
      deps.dropHost.current
        ? createCardDrop({
            root: deps.dropHost.current,
            subscribe: subscribeFileDrop,
            isImporting: io.isImporting,
            importDropped: io.importDropped,
            log: deps.log,
          })
        : undefined);

  const revision = createPageRevision();
  const refresh = revision.bump;
  const redraw = (): void => {
    if (isOpen()) refresh();
  };
  const subscribes = [
    () => agentSettings.subscribe(redraw),
    () => endpointsSettings.subscribe(redraw),
    registry && (() => registry.subscribe(redraw)),
    () => subscribeLocale(redraw),
  ];

  return {
    view: () =>
      createElement(
        "div",
        { className: "yui-tab-stack" },
        createElement(
          PersonaSources,
          { subscribes, drop },
          revision.view(() => createElement(PersonaPageView, { ...deps, io, refresh })),
        ),
      ),
    reflect: refresh,
  };
}
