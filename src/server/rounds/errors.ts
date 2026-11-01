/** Expected failures of the verified round lifecycle, mapped to HTTP statuses. */
export type RoundErrorCode =
  | "invalid_payload"
  | "not_found"
  | "session_closed"
  | "deadline_passed"
  | "rate_limited"
  | "unsupported_rules"
  | "unknown_player"
  | "unknown_department"
  | "already_member"
  | "transfer_cooldown"
  | "daily_in_progress"
  | "daily_attempt_used"
  | "unknown_daily_challenge";

const STATUS: Record<RoundErrorCode, number> = {
  invalid_payload: 400,
  not_found: 404,
  session_closed: 409,
  deadline_passed: 409,
  rate_limited: 429,
  unsupported_rules: 500,
  unknown_player: 403,
  unknown_department: 400,
  already_member: 409,
  transfer_cooldown: 409,
  daily_in_progress: 409,
  daily_attempt_used: 409,
  unknown_daily_challenge: 404,
};

const MESSAGES: Record<RoundErrorCode, string> = {
  invalid_payload: "The request was not understood.",
  not_found: "That round doesn't exist.",
  session_closed: "That round is no longer active.",
  deadline_passed: "The round's time limit has passed.",
  rate_limited: "Too many requests. Please wait a moment.",
  unsupported_rules: "This round uses rules the server no longer supports.",
  unknown_player: "Your employee profile is missing.",
  unknown_department: "That department doesn't exist.",
  already_member: "You already work in that department.",
  transfer_cooldown: "Transfers are possible 30 days after joining your current department.",
  daily_in_progress: "Your ranked Daily Challenge round is still running. Finish it in Daily Assignments, or wait for its timer to end.",
  daily_attempt_used: "You've already used today's ranked attempt for this challenge. A new one opens at 00:00 UTC.",
  unknown_daily_challenge: "That Daily Challenge isn't available.",
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
    unknown_department: "unknown_department",
    already_member: "already_member",
    transfer_cooldown: "transfer_cooldown",
    invalid_request: "invalid_payload",
    daily_in_progress: "daily_in_progress",
    unknown_daily_challenge: "unknown_daily_challenge",
  };
  for (const [needle, code] of Object.entries(known)) {
    if (message.includes(needle)) return new RoundError(code);
  }
  return null;
}
