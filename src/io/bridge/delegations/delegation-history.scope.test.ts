// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { DelegationItem } from "../../chat/push/push-frames";
import { createDelegationHistory } from "./delegation-history";

const NOW = 1_789_365_900_000;

afterEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
});

function done(id: string): DelegationItem {
  return {
    id,
    title: `work ${id}`,
    started_at: NOW - 600_000,
    state: "done",
    ended_at: NOW,
    status: "ok",
  };
}

it("keeps two presets' delegation histories apart and reads the edited preset's", () => {
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({
      active: "default",
      list: [
        { id: "default", name: "Default" },
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    }),
  );
  history.replaceState(null, "", "/?preset=a");
  const a = createDelegationHistory();
  a.merge([done("a-1")]);
  history.replaceState(null, "", "/?preset=b");
  const b = createDelegationHistory();
  b.merge([done("b-1")]);

  history.replaceState(null, "", "/?preset=a&edit=b");
  const edited = createDelegationHistory();

  expect(edited.get().map((item) => item.id)).toEqual(["b-1"]);
  expect(JSON.parse(localStorage.getItem("yui.a.delegation_history")!)).toEqual([done("a-1")]);
  expect(JSON.parse(localStorage.getItem("yui.b.delegation_history")!)).toEqual([done("b-1")]);
  a.dispose();
  b.dispose();
  edited.dispose();
});
