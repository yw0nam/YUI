// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n";
import { renderSignalDetails } from "./signal-details";

describe("renderSignalDetails", () => {
  afterEach(() => setLocale("en"));

  it.each([
    ["en", "03:51 PM"],
    ["ko", "오후 03:51"],
  ] as const)("shows the received time in the app locale %s", (locale, expected) => {
    setLocale(locale);
    const sheet = renderSignalDetails(
      {
        group: {
          envelope: {
            source: "gh",
            event_type: "ci.failed",
            delivery: "batched",
            event_id: "e1",
            occurred_at: 1,
          },
          items: [],
        },
        delivery: "batched",
        received_at: new Date(2026, 0, 2, 15, 51).getTime(),
        said: null,
      },
      { onDismiss: () => {}, onClose: () => {} },
    );

    const received = sheet.querySelector(".yui-sigdetails__rows dd:last-of-type")!.textContent!;
    expect(received.replace(/\s/g, " ")).toBe(expected);
  });
});
