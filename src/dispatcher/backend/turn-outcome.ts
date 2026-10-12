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

/** The server's own failure text for a failed turn, with the HTTP status when the failure had one. */
export type TurnErrorDetail = { status?: number; message: string };

/** Every outcome except success — what a drop record and the UI error surface deal in. */
export type TurnFailure = Exclude<TurnOutcome, "ok">;
