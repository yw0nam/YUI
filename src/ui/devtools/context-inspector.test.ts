// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createContextHistory } from "../../io/context-history";
import { createContextInspector } from "./context-inspector";

describe("Context Inspector", () => {
  it("renders empty state, then live history detail with excluded OFF pills", () => {
    const mount = document.createElement("section");
    const history = createContextHistory();
    createContextInspector(mount, history);
    expect(mount.textContent).toContain("No sent context yet");

    history.append({
      ts: 100,
      event_name: "proactive.idle",
      trigger_kind: "proactive",
      included: ["active_app"],
      excluded: ["active_window_title"],
      client_context: {
        env: {
          timestamp: "2026-07-23T10:00:00+09:00",
          timezone: "Asia/Seoul",
          active_app: { name: "Code" },
        },
        trigger: { kind: "proactive" },
      },
    });

    expect(mount.textContent).toContain("proactive.idle");
    expect(mount.textContent).toContain("title OFF");
    expect(mount.querySelector(".devtools-json")?.textContent).toContain('"active_app": {');
  });
});
