/** How a backend call settled. */

/** Every outcome a backend call can settle to. */
export type TurnOutcome =
  | "ok"
  | "not_configured"
  | "parse_error"
  | "network_drop"
  | "network_stall"
  | "http_4xx_drop"
  | "superseded_by_user";

/** Every outcome except success — what a drop record and the UI error surface deal in. */
export type TurnFailure = Exclude<TurnOutcome, "ok">;
