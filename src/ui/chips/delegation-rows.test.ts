// @vitest-environment jsdom
/**
 * delegation-rows.test.ts — the delegation list's shared pieces: relative time text off the
 * backend's epoch stamps, running-first order, and the row DOM both the chip and the
 * settings panel render.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { DelegationItem } from "../../io/chat/push-socket";
import { type Locale, setLocale } from "../i18n";
import {
  formatDelegationDuration,
  formatDelegationTime,
  renderDelegationRows,
  sortDelegations,
} from "./delegation-rows";

const NOW = 1_789_365_900_000;

function running(id: string, startedAgoMs: number): DelegationItem {
  return { id, title: `work ${id}`, started_at: NOW - startedAgoMs, state: "running" };
}

function done(id: string, endedAgoMs: number): DelegationItem {
  return {
    id,
    title: `work ${id}`,
    started_at: NOW - endedAgoMs - 600_000,
    state: "done",
    ended_at: NOW - endedAgoMs,
  };
}

afterEach(() => {
  setLocale("en");
});

describe("formatDelegationDuration — minutes under an hour, hours and minutes above", () => {
  const cases: [Locale, number, string][] = [
    ["en", 4 * 60_000, "4m"],
    ["en", 72 * 60_000, "1h 12m"],
    ["ko", 4 * 60_000, "4분"],
    ["ko", 72 * 60_000, "1시간 12분"],
    ["ja", 4 * 60_000, "4分"],
    ["ja", 72 * 60_000, "1時間12分"],
  ];
  it.each(cases)("formats %ims in %s as %s", (locale, ms, expected) => {
    setLocale(locale);
    expect(formatDelegationDuration(ms)).toBe(expected);
  });

  it("never goes below zero minutes", () => {
    setLocale("ko");
    expect(formatDelegationDuration(-60_000)).toBe("0분");
  });
});

describe("formatDelegationTime — one row's right-side text", () => {
  it("shows the elapsed time for a running item", () => {
    setLocale("ko");
    expect(formatDelegationTime(running("d-1", 4 * 60_000), NOW)).toBe("4분");
  });

  it("shows 'done' with an ago stamp for a finished item", () => {
    setLocale("ko");
    expect(formatDelegationTime(done("d-1", 12 * 60_000), NOW)).toBe("끝남 · 12분 전");
  });

  it("shows the bare done label when the backend sent no ended_at", () => {
    setLocale("ko");
    const item = { ...done("d-1", 0), ended_at: undefined };
    expect(formatDelegationTime(item, NOW)).toBe("끝남");
  });

  it("reads failed with an ago stamp when the status is error", () => {
    expect(formatDelegationTime({ ...done("d-1", 4 * 60_000), status: "error" }, NOW)).toBe(
      "Failed · 4m ago",
    );
  });

  it("reads done for ok and unknown alike", () => {
    expect(formatDelegationTime({ ...done("d-1", 4 * 60_000), status: "ok" }, NOW)).toBe(
      "Done · 4m ago",
    );
    expect(formatDelegationTime({ ...done("d-2", 4 * 60_000), status: "unknown" }, NOW)).toBe(
      "Done · 4m ago",
    );
  });
});

describe("sortDelegations — running first, each group in the backend's order", () => {
  it("partitions done items behind running ones", () => {
    const items = [
      done("d-3", 60_000),
      running("d-1", 60_000),
      done("d-4", 60_000),
      running("d-2", 60_000),
    ];
    expect(sortDelegations(items).map((d) => d.id)).toEqual(["d-1", "d-2", "d-3", "d-4"]);
  });
});

describe("renderDelegationRows — the row DOM", () => {
  it("builds one row per item with its state, title, and time", () => {
    setLocale("ko");
    const container = document.createElement("div");
    renderDelegationRows(container, [done("d-2", 12 * 60_000), running("d-1", 4 * 60_000)], NOW);

    const rows = [...container.querySelectorAll<HTMLDivElement>(".yui-deleg__item")];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.dataset.state).toBe("running");
    expect(rows[0]!.querySelector(".yui-deleg__item-title")!.textContent).toBe("work d-1");
    expect(rows[0]!.querySelector(".yui-deleg__item-time")!.textContent).toBe("4분");
    expect(rows[1]!.dataset.state).toBe("done");
    expect(rows[1]!.querySelector(".yui-deleg__item-time")!.textContent).toBe("끝남 · 12분 전");
  });

  it("replaces the previous rows instead of appending", () => {
    const container = document.createElement("div");
    renderDelegationRows(container, [running("d-1", 60_000)], NOW);
    renderDelegationRows(container, [running("d-2", 60_000)], NOW);

    const rows = [...container.querySelectorAll<HTMLDivElement>(".yui-deleg__item")];
    expect(rows.map((r) => r.querySelector(".yui-deleg__item-title")!.textContent)).toEqual([
      "work d-2",
    ]);
  });

  it("stamps the status on the row and leaves it off when the backend sent none", () => {
    const container = document.createElement("div");
    renderDelegationRows(container, [{ ...done("d-1", 0), status: "error" }, done("d-2", 0)], NOW);

    const rows = [...container.querySelectorAll<HTMLDivElement>(".yui-deleg__item")];
    expect(rows[0]!.dataset.status).toBe("error");
    expect(rows[1]!.dataset.status).toBeUndefined();
  });

  describe("with a summary disclosure", () => {
    it("renders a done item with a summary as a closed disclosure button", () => {
      const container = document.createElement("div");
      renderDelegationRows(
        container,
        [{ ...done("d-1", 100_000), status: "ok", summary: "All three logs are under 10 MB." }],
        NOW,
        { open: new Set<string>(), onToggle: () => {} },
      );

      const button = container.querySelector<HTMLButtonElement>("button.yui-deleg__item--toggle");
      expect(button).not.toBeNull();
      expect(button!.getAttribute("aria-expanded")).toBe("false");
      expect(button!.querySelector(".yui-deleg__item-chev")).not.toBeNull();
      expect(container.querySelector(".yui-deleg__summary")).toBeNull();
    });

    it("opens the summary and the duration on click, keeps focus on the rebuilt row, and closes on the next", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const open = new Set<string>();
      const item = { ...done("d-1", 100_000), status: "ok" as const, summary: "All green." };
      const render = (): void =>
        renderDelegationRows(container, [item], NOW, { open, onToggle: render });
      render();

      const button = (): HTMLButtonElement =>
        container.querySelector<HTMLButtonElement>("button.yui-deleg__item--toggle")!;
      // jsdom's click() skips the native focus-on-click, so emulate it.
      button().focus();
      button().click();

      expect(button().getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector(".yui-deleg__summary-text")!.textContent).toBe("All green.");
      expect(container.querySelector(".yui-deleg__summary-meta")!.textContent).toBe("Took 10m");
      expect(document.activeElement).toBe(button());

      button().click();

      expect(container.querySelector(".yui-deleg__summary")).toBeNull();
      expect(open.size).toBe(0);
      container.remove();
    });

    it("keeps focus on the open row across a re-render", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const open = new Set<string>();
      const item = { ...done("d-1", 100_000), status: "ok" as const, summary: "All green." };
      const render = (items: DelegationItem[]): void =>
        renderDelegationRows(container, items, NOW, { open, onToggle: () => render(items) });
      render([item]);

      const first = container.querySelector<HTMLButtonElement>("button.yui-deleg__item--toggle")!;
      // jsdom's click() skips the native focus-on-click, so emulate it.
      first.focus();
      first.click();
      expect(document.activeElement!.tagName).toBe("BUTTON");

      // A new running item lands before the done row, so its index changes.
      render([running("d-2", 60_000), item]);

      const button = container.querySelector<HTMLButtonElement>("button.yui-deleg__item");
      expect(button!.dataset.id).toBe("d-1");
      expect(document.activeElement).toBe(button);
      expect(button!.getAttribute("aria-expanded")).toBe("true");
      container.remove();
    });

    it("leaves a running item, a done item without a summary, and one with an empty summary as plain rows", () => {
      const container = document.createElement("div");
      renderDelegationRows(
        container,
        [running("d-1", 60_000), done("d-2", 60_000), { ...done("d-3", 60_000), summary: "" }],
        NOW,
        { open: new Set<string>(), onToggle: () => {} },
      );

      const rows = [...container.querySelectorAll(".yui-deleg__item")];
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.tagName).toBe("DIV");
        expect(row.classList.contains("yui-deleg__item--toggle")).toBe(false);
        expect(row.querySelector(".yui-deleg__item-chev")).toBeNull();
      }
    });
  });
});
