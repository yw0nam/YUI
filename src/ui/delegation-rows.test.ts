// @vitest-environment jsdom
/**
 * delegation-rows.test.ts — the delegation list's shared pieces: relative time text off the
 * backend's epoch stamps, running-first order, and the row DOM both the chip and the
 * settings panel render.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { DelegationItem } from "../io/chat/push-socket";
import {
  formatDelegationDuration,
  formatDelegationTime,
  renderDelegationRows,
  sortDelegations,
} from "./delegation-rows";
import { type Locale, setLocale } from "./i18n";

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
});
