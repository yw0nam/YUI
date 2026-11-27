import { beforeEach, describe, expect, it } from "vitest";
import { setLocale, t } from "../../ui/i18n";
import type { BusEnvelope } from "../core/event-bus";
import { triggerLineOf } from "./trigger-line";

function envOf(
  over: Pick<BusEnvelope, "source" | "event_name"> & Partial<BusEnvelope>,
): BusEnvelope {
  return { ts: 0, ...over };
}

describe("triggerLineOf", () => {
  beforeEach(() => {
    setLocale("en");
  });
  it("names a schedule cue with its time and label", () => {
    expect(
      triggerLineOf(
        envOf({
          source: "timer_scheduler",
          event_name: "schedule.morning",
          payload: { cue_id: "morning", label: "Morning greeting", context: "", time: "09:00" },
        }),
        t,
      ),
    ).toBe("09:00 Morning greeting");
  });

  it("names an idle cue by its label", () => {
    expect(
      triggerLineOf(
        envOf({
          source: "timer_scheduler",
          event_name: "proactive.checkin",
          payload: { cue_id: "checkin", label: "Gentle check" },
        }),
        t,
      ),
    ).toBe("Gentle check");
  });

  it("reads an idle cue whose id looks like a gesture as an idle cue", () => {
    expect(
      triggerLineOf(
        envOf({
          source: "timer_scheduler",
          event_name: "proactive.tap_bored",
          payload: { cue_id: "tap_bored", label: "Gentle check" },
        }),
        t,
      ),
    ).toBe("Gentle check");
  });

  it("names the day's first meeting", () => {
    expect(
      triggerLineOf(
        envOf({ source: "os_event_watcher", event_name: "time_milestone.first_activity" }),
        t,
      ),
    ).toBe("First time today");
  });

  it("names the app a screen switch landed on", () => {
    expect(
      triggerLineOf(
        envOf({
          source: "screen_watcher",
          event_name: "proactive.screen_app_switched",
          payload: { transition: "app_switched", app: "Slack", dwell_min: 2 },
        }),
        t,
      ),
    ).toBe("Switched to Slack");
  });

  it("names the character that spoke to her", () => {
    expect(
      triggerLineOf(
        envOf({
          source: "addressed_source",
          event_name: "addressed.character",
          payload: { from: "natsume", name: "Natsume", line: "Hi" },
        }),
        t,
      ),
    ).toBe("Natsume spoke to her");
  });

  it("names a bundle by its first line and counts the other members and groups", () => {
    expect(
      triggerLineOf(
        envOf({
          source: "timer_scheduler",
          event_name: "schedule.lunch",
          payload: {
            cue_id: "lunch",
            label: "Lunch",
            time: "12:00",
            waited: [
              {
                source: "timer_scheduler",
                event_name: "schedule.walk",
                ts: 1,
                payload: { cue_id: "walk", label: "Walk", time: "12:10" },
              },
              {
                source: "screen_watcher",
                event_name: "proactive.screen_app_switched",
                ts: 2,
                payload: { transition: "app_switched", app: "Slack", dwell_min: 2 },
              },
            ],
            signals: [
              { envelope: {}, items: [] },
              { envelope: {}, items: [] },
            ],
          },
        }),
        t,
      ),
    ).toBe("12:00 Lunch +4");
  });

  it("takes the first line a waited member carries when the top has none", () => {
    expect(
      triggerLineOf(
        envOf({
          source: "os_event_watcher",
          event_name: "proactive.dropped",
          payload: {
            cue_id: "dropped",
            label: "dropped",
            waited: [
              {
                source: "os_event_watcher",
                event_name: "proactive.dropped",
                ts: 1,
                payload: { cue_id: "dropped", label: "dropped" },
              },
              {
                source: "timer_scheduler",
                event_name: "schedule.lunch",
                ts: 2,
                payload: { label: "Lunch", time: "12:00" },
              },
            ],
          },
        }),
        t,
      ),
    ).toBe("12:00 Lunch +2");
  });

  it("shows no line for a user turn that carries waited members", () => {
    const waited = [
      {
        source: "timer_scheduler",
        event_name: "schedule.lunch",
        ts: 1,
        payload: { label: "Lunch", time: "12:00" },
      },
    ];
    const signals = [{ envelope: {}, items: [] }];

    expect(
      triggerLineOf(
        envOf({
          source: "user_input_source",
          event_name: "user.text_submitted",
          payload: { text: "hi", waited, signals },
        }),
        t,
      ),
    ).toBeNull();
    expect(
      triggerLineOf(
        envOf({
          source: "timer_scheduler",
          event_name: "schedule.walk",
          payload: { label: "Walk", time: "12:10", waited, signals },
        }),
        t,
      ),
    ).toBe("12:10 Walk +2");
  });

  it("counts a waited member only when it carries an event name and a numeric ts", () => {
    expect(
      triggerLineOf(
        envOf({
          source: "timer_scheduler",
          event_name: "schedule.lunch",
          payload: {
            label: "Lunch",
            time: "12:00",
            waited: [
              {
                source: "timer_scheduler",
                event_name: "schedule.walk",
                ts: 1,
                payload: { label: "Walk", time: "12:10" },
              },
              {
                source: "timer_scheduler",
                event_name: "schedule.tea",
                ts: "2",
                payload: { label: "Tea", time: "12:20" },
              },
              {
                source: "timer_scheduler",
                payload: { label: "None", time: "12:30" },
              },
            ],
          },
        }),
        t,
      ),
    ).toBe("12:00 Lunch +1");
  });

  it.each<[string, BusEnvelope]>([
    [
      "a long session",
      envOf({
        source: "screen_watcher",
        event_name: "proactive.screen_long_session",
        payload: { transition: "long_session", app: "Slack", dwell_min: 45 },
      }),
    ],
    [
      "a gesture",
      envOf({
        source: "os_event_watcher",
        event_name: "proactive.dropped",
        payload: { cue_id: "dropped", label: "dropped from mid-air" },
      }),
    ],
    ["a signal turn", envOf({ source: "urgent_signal_source", event_name: "signals.urgent" })],
    [
      "a user turn",
      envOf({
        source: "user_input_source",
        event_name: "user.text_submitted",
        payload: { text: "hi" },
      }),
    ],
  ])("shows no trigger line for %s", (_title, env) => {
    expect(triggerLineOf(env, t)).toBeNull();
  });
});
