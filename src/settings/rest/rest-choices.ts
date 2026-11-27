/** Rest's choices, one vocabulary for the Character menu, the bridge, the tray and the pace.rest row. */

export const REST_CHOICES = [
  "hour",
  "tonight",
  "morning",
  "until_off",
  "focus_25",
  "focus_50",
] as const;
export type RestChoice = (typeof REST_CHOICES)[number];

export const isRestChoice = (v: unknown): v is RestChoice =>
  (REST_CHOICES as readonly unknown[]).includes(v);

/** What holds her own turns now: a Rest or Focus the user started, or an active-hours quiet span. */
export interface RestState {
  kind: "rest" | "focus" | "quiet";
  choice?: RestChoice;
  startedAt?: number;
  endsAt?: number;
}
