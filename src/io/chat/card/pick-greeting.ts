import type { Card } from "../../../config/validators/persona/types";

/** One of the card's non-empty greetings at random, as raw text; null when it has none. */
export function pickGreeting(card: Card, random: () => number = Math.random): string | null {
  const greetings = [card.first_mes, ...card.alternate_greetings].filter((g) => g);
  if (greetings.length === 0) return null;
  return greetings[Math.floor(random() * greetings.length)];
}
