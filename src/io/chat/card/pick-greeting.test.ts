import { describe, expect, it } from "vitest";
import { EMPTY_CARD } from "../../../config/validators/persona/types";
import { pickGreeting } from "./pick-greeting";

describe("pickGreeting", () => {
  it("returns null when the card has no greeting", () => {
    expect(pickGreeting({ ...EMPTY_CARD, alternate_greetings: [""] })).toBeNull();
  });

  it("picks the greeting at the random index among the non-empty ones", () => {
    const card = { ...EMPTY_CARD, first_mes: "Hi.", alternate_greetings: ["", "Hey.", "Yo."] };
    expect(pickGreeting(card, () => 0)).toBe("Hi.");
    expect(pickGreeting(card, () => 0.5)).toBe("Hey.");
    expect(pickGreeting(card, () => 0.99)).toBe("Yo.");
  });
});
