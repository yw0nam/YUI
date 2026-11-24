// @vitest-environment jsdom

import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContextHistoryEntry,
  createContextHistory,
} from "../../io/chat/conversation/context-history";
import { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { setLocale } from "../i18n";
import { createDevtoolsShell } from "./shell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (ts: number, event_name: string): ContextHistoryEntry => ({
  ts,
  event_name,
  trigger_kind: "proactive",
  client_context: {
    env: { timestamp: "2026-07-23T10:00:00+09:00", timezone: "Asia/Seoul" },
    trigger: { kind: "proactive" },
  },
});

describe("Context Inspector", () => {
  let shell: ReturnType<typeof createDevtoolsShell> | null = null;

  function inspect(history: ReturnType<typeof createContextHistory>) {
    document.body.innerHTML = '<div id="app"></div>';
    shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history,
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview: vi.fn(async () => ({ dispose: vi.fn() })),
    });
  }
  const json = () => document.querySelector(".devtools-json")?.textContent;

  beforeEach(() => setLocale("en"));
  afterEach(() => {
    act(() => shell?.dispose());
    shell = null;
    document.body.innerHTML = "";
  });

  it("renders empty state, then live history detail keyed by event_name", () => {
    const history = createContextHistory();
    inspect(history);
    expect(document.body.textContent).toContain("No sent context yet");

    act(() => history.append(entry(100, "proactive.idle")));

    expect(document.body.textContent).toContain("proactive.idle");
    expect(json()).toContain('"timezone"');
  });

  it("lists turns newest first and keeps the selection on its turn while it exists, else the newest", () => {
    const history = createContextHistory();
    history.append(entry(100, "first"));
    history.append(entry(200, "second"));
    inspect(history);
    const selection = () =>
      screen
        .queryAllByRole("option")
        .map((o) => [
          o.querySelector(".devtools-turn__summary")?.textContent,
          o.getAttribute("aria-selected"),
        ]);
    expect(selection()).toEqual([
      ["second", "true"],
      ["first", "false"],
    ]);

    act(() => history.append(entry(300, "third")));
    expect(selection()).toEqual([
      ["third", "false"],
      ["second", "true"],
      ["first", "false"],
    ]);

    act(() => screen.getAllByRole("option")[2]!.click());
    expect(document.querySelector(".devtools-detail-header .devtools-event")?.textContent).toBe(
      "first",
    );

    // The history's cap of 20 drops the selected oldest turn.
    act(() => {
      for (let ts = 400; ts < 420; ts++) history.append(entry(ts, `t${ts}`));
    });
    expect(selection()[0]).toEqual(["t419", "true"]);
  });

  it("localizes inspector chrome without translating event names or JSON keys", () => {
    setLocale("ko");
    const history = createContextHistory();
    history.append(entry(100, "proactive.idle"));

    inspect(history);

    expect(screen.queryByRole("listbox", { name: "최근 턴" })).not.toBeNull();
    expect(document.body.textContent).toContain("proactive.idle");
    expect(json()).toContain('"timezone"');
  });
});
