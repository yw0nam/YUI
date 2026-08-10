// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { createContextHistory } from "../../io/context-history";
import { setLocale } from "../i18n";
import { createContextInspector } from "./context-inspector";

describe("Context Inspector", () => {
  beforeEach(() => setLocale("en"));

  it("renders empty state, then live history detail keyed by event_name", () => {
    const mount = document.createElement("section");
    const history = createContextHistory();
    createContextInspector(mount, history);
    expect(mount.textContent).toContain("No sent context yet");

    history.append({
      ts: 100,
      event_name: "proactive.idle",
      trigger_kind: "proactive",
      client_context: {
        env: { timestamp: "2026-07-23T10:00:00+09:00", timezone: "Asia/Seoul" },
        trigger: { kind: "proactive" },
      },
    });

    expect(mount.textContent).toContain("proactive.idle");
    expect(mount.querySelector(".devtools-json")?.textContent).toContain('"timezone"');
  });

  it("localizes inspector chrome without translating event names or JSON keys", () => {
    setLocale("ko");
    const mount = document.createElement("section");
    const history = createContextHistory();
    history.append({
      ts: 100,
      event_name: "proactive.idle",
      trigger_kind: "proactive",
      client_context: {
        env: { timestamp: "2026-07-23T10:00:00+09:00", timezone: "Asia/Seoul" },
        trigger: { kind: "proactive" },
      },
    });

    createContextInspector(mount, history);

    expect(mount.querySelector(".devtools-turns")?.getAttribute("aria-label")).toBe("최근 턴");
    expect(mount.textContent).toContain("proactive.idle");
    expect(mount.querySelector(".devtools-json")?.textContent).toContain('"timezone"');
  });
});
