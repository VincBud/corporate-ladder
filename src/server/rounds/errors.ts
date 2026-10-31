/** Expected failures of the verified round lifecycle, mapped to HTTP statuses. */
export type RoundErrorCode =
  | "invalid_payload"
  | "not_found"
  | "session_closed"
  | "deadline_passed"
  | "rate_limited"
  | "unsupported_rules"
  | "unknown_player";

const STATUS: Record<RoundErrorCode, number> = {
  invalid_payload: 400,
  not_found: 404,
  session_closed: 409,
  deadline_passed: 409,
  rate_limited: 429,
  unsupported_rules: 500,
  unknown_player: 403,
};

const MESSAGES: Record<RoundErrorCode, string> = {
  invalid_payload: "The request was not understood.",
  not_found: "That round doesn't exist.",
  session_closed: "That round is no longer active.",
  deadline_passed: "The round's time limit has passed.",
  rate_limited: "Too many requests. Please wait a moment.",
  unsupported_rules: "This round uses rules the server no longer supports.",
  unknown_player: "Your employee profile is missing.",
};

export class RoundError extends Error {
  readonly status: number;
  constructor(
    readonly code: RoundErrorCode,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

/** Maps exceptions raised by the SQL functions to RoundErrors. */
export function fromDatabaseError(message: string): RoundError | null {
  const known: Record<string, RoundErrorCode> = {
    rate_limited: "rate_limited",
    session_not_found: "not_found",
    session_closed: "session_closed",
    deadline_passed: "deadline_passed",
    unknown_player: "unknown_player",
    unknown_game: "unsupported_rules",
  };
  for (const [needle, code] of Object.entries(known)) {
    if (message.includes(needle)) return new RoundError(code);
  }
  return null;
}
