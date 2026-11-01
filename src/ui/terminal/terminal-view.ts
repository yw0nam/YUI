/**
 * The Threads window's Terminal tab: the list or its rail beside the terminal pane, the Allow card
 * across the foot, kept on the newest terminal snapshot. The selection survives snapshots; a
 * terminal the user opens is selected and focused once a snapshot lists it.
 */

import "./terminal-view.css";
import type { AccessRequest, Terminal, TerminalSnapshot } from "../../contract";
import type { TerminalClient } from "../../io/terminal/terminal-client";
import { createLogger } from "../../logger";
import { subscribe as subscribeLocale, t } from "../i18n";
import type { TabBody, TabShell } from "../threads/window/threads-tabs";
import { createAccessLine } from "./access-line";
import { createRequestCard } from "./request-card";
import { createTerminalList } from "./terminal-list";
import type { PresetLookup } from "./terminal-meta";
import { createTerminalPane } from "./terminal-pane";
import { createTerminalRail } from "./terminal-rail";
import { createTerminalScreens } from "./terminal-screens";

const log = createLogger("terminal-view");

export interface TerminalView extends TabBody {
  update(snapshot: TerminalSnapshot): void;
}

export function createTerminalView(deps: {
  shell: TabShell;
  now(): number;
  preset: PresetLookup;
  client: Pick<
    TerminalClient,
    "open" | "close" | "input" | "resize" | "attach" | "answer" | "takeBack"
  >;
}): TerminalView {
  const { shell, client, preset } = deps;
  const warn = (event: string) => (error: unknown) => log.warn(event, { error: String(error) });
  let terminals: Terminal[] = [];
  let requests: AccessRequest[] = [];
  let selected: string | null = null;
  let opening: string | null = null;

  const list = createTerminalList({ preset, onSelect: select, onNew: openNew });
  const rail = createTerminalRail({ preset, onSelect: select, onNew: openNew });
  const access = createAccessLine({ preset, takeBack: client.takeBack });
  const screens = createTerminalScreens(client);
  const pane = createTerminalPane({
    back: shell.back,
    parts: [access.el, screens.el],
    preset,
    onClose: (id) => void client.close(id).catch(warn("close_failed")),
  });
  const card = createRequestCard({ now: deps.now, preset, answer: client.answer, onShow: select });
  const panes = document.createElement("div");
  panes.className = "yui-threads__panes";
  panes.append(list.el, rail.el, pane.el);
  const el = document.createElement("div");
  el.className = "yui-terminal";
  el.append(panes, card.el);

  function render(): void {
    const shown = terminals.find((term) => term.id === selected);
    list.render(terminals, requests, selected, deps.now());
    rail.render(terminals, requests, selected);
    pane.show(shown);
    access.show(shown);
    screens.show(selected);
    card.render(requests, terminals, selected);
    shell.headChanged();
  }

  function select(id: string): void {
    selected = id;
    const listHid = shell.selected();
    render();
    if (listHid) screens.focus();
  }

  function openNew(): void {
    client.open().then((id) => {
      if (id) opening = id;
    }, warn("open_failed"));
  }

  const offLocale = subscribeLocale(render);
  render();

  return {
    el,
    list: list.el,
    update(snapshot) {
      terminals = [...snapshot.terminals].sort((a, b) => b.openedAt - a.openedAt);
      requests = snapshot.requests;
      screens.sync(terminals);
      const opened = opening !== null && terminals.some((term) => term.id === opening);
      if (opened) {
        select(opening!);
        opening = null;
        screens.focus();
        return;
      }
      if (!terminals.some((term) => term.id === selected)) selected = terminals[0]?.id ?? null;
      render();
    },
    head: () => ({
      count: terminals.length ? t("terminal.count", { n: terminals.length }) : "",
      waiting: requests.length > 0,
    }),
    hasSelection: () => selected !== null,
    focusList: list.focusSelected,
    focusRail: rail.focusSelected,
    move(delta) {
      const at = terminals.findIndex((term) => term.id === selected);
      const next = terminals[Math.min(terminals.length - 1, Math.max(0, at + delta))];
      if (!next) return;
      selected = next.id;
      render();
      shell.focusSelected();
    },
    shown: () => screens.show(selected),
    dispose() {
      offLocale();
      access.dispose();
      card.dispose();
      screens.dispose();
    },
  };
}
