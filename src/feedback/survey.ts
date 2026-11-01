/**
 * Employee Experience Survey (closed alpha): definitions, validation shared
 * with the server, and the automatic-prompt rules. No browser or React APIs
 * here (the server imports it); see survey-memory.ts for the browser state.
 *
 * Prompting: after the third completed round (both games, submitted or
 * timed out, distinct sessions). If dismissed, one reminder after two more
 * completed rounds; after that, or after a submission, never automatically
 * again. Always reachable from Launcher → People & Culture.
 */
export const SURVEY_VERSION = "alpha-1";
export const PROMPT_AFTER_ROUNDS = 3;
export const REMINDER_AFTER_ROUNDS = 2;
export const MAX_AUTO_PROMPTS = 2;
export const MAX_TEXT_LENGTH = 1000;
export const SURVEY_GAMES = ["reconciliation-rush", "pipeline-panic"] as const;
export const DEVICE_CATEGORIES = ["desktop", "tablet", "mobile", "unknown"] as const;

export type RatingKey = "gameplayFun" | "easeOfUnderstanding" | "playability" | "replayAppeal";
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

export const QUESTIONS: ReadonlyArray<{ key: RatingKey; label: string; description: string }> = [
  { key: "gameplayFun", label: "Gameplay Fun", description: "Was it actually fun? HR is not in the room." },
  { key: "easeOfUnderstanding", label: "Ease of Understanding", description: "Did you know what to do without a three-hour training?" },
  { key: "playability", label: "Playability", description: "Controls, speed and layout. Did anything get in the way?" },
  { key: "replayAppeal", label: "Replay Appeal", description: "Would you clock in for another round?" },
];

export interface FeedbackSubmission {
  requestId: string;
  ratings: Record<RatingKey, number>;
  enjoyed: string | null;
  improve: string | null;
  context: { gamesPlayed: string[]; completedRounds: number; deviceCategory: DeviceCategory };
  /** Guests only: random browser token used to group a guest's own revisions. */
  guestToken?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Trims, removes control characters (keeps line breaks), empty → null. Null if too long or not text. */
function cleanText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (cleaned.length > MAX_TEXT_LENGTH) return { ok: false };
  return { ok: true, value: cleaned === "" ? null : cleaned };
}

export type ValidationResult = { ok: true; value: FeedbackSubmission } | { ok: false; error: string };

/** Strict validation of a submission body (the server's source of truth). */
export function validateSubmission(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "The request was not understood." };
  const b = body as Record<string, unknown>;
  if (!isUuid(b.requestId)) return { ok: false, error: "Missing request id." };
  const r = b.ratings as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return { ok: false, error: "Please rate all four questions." };
  const ratings = {} as Record<RatingKey, number>;
  for (const { key } of QUESTIONS) {
    const v = r[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 10) return { ok: false, error: "Please rate all four questions from 1 to 10." };
    ratings[key] = v;
  }
  const enjoyed = cleanText(b.enjoyed);
  const improve = cleanText(b.improve);
  if (!enjoyed.ok || !improve.ok) return { ok: false, error: `Comments can be up to ${MAX_TEXT_LENGTH} characters.` };
  const c = (b.context ?? {}) as Record<string, unknown>;
  const games = Array.isArray(c.gamesPlayed) ? c.gamesPlayed.filter((g): g is string => (SURVEY_GAMES as readonly string[]).includes(g as string)) : [];
  const rounds = typeof c.completedRounds === "number" && Number.isInteger(c.completedRounds) ? Math.min(Math.max(c.completedRounds, 0), 100_000) : 0;
  const device = (DEVICE_CATEGORIES as readonly string[]).includes(c.deviceCategory as string) ? (c.deviceCategory as DeviceCategory) : "unknown";
  if (b.guestToken !== undefined && !isUuid(b.guestToken)) return { ok: false, error: "The request was not understood." };
  return {
    ok: true,
    value: {
      requestId: b.requestId,
      ratings,
      enjoyed: enjoyed.value,
      improve: improve.value,
      context: { gamesPlayed: [...new Set(games)].sort(), completedRounds: rounds, deviceCategory: device },
      guestToken: b.guestToken as string | undefined,
    },
  };
}

/** Broad device class from screen size and pointer type only (no user agent, no fingerprinting). */
export function deviceCategoryFor(width: number, coarsePointer: boolean): DeviceCategory {
  if (!Number.isFinite(width) || width <= 0) return "unknown";
  if (width < 640) return "mobile";
  if (coarsePointer && width < 1200) return "tablet";
  return "desktop";
}

// --- Prompt rules --------------------------------------------------------------

export interface SurveyMemory {
  /** Automatic prompts shown so far (each counts as soon as it opens). */
  autoPrompts: number;
  /** Completed rounds when the last automatic prompt opened. */
  lastPromptRounds: number;
  submittedAt: string | null;
}

export const EMPTY_MEMORY: SurveyMemory = { autoPrompts: 0, lastPromptRounds: 0, submittedAt: null };

export interface AutoPromptInput {
  /** null: storage blocked or not read yet → never prompt automatically. */
  memory: SurveyMemory | null;
  completedRounds: number;
  /** Server says this account already submitted (accounts only). */
  submittedOnServer: boolean;
  /** A round, briefing, result/review, orientation or another dialog is in the way. */
  blocked: boolean;
}

export function shouldAutoPromptSurvey({ memory, completedRounds, submittedOnServer, blocked }: AutoPromptInput): boolean {
  if (!memory || blocked || submittedOnServer || memory.submittedAt) return false;
  if (memory.autoPrompts >= MAX_AUTO_PROMPTS) return false;
  if (memory.autoPrompts === 0) return completedRounds >= PROMPT_AFTER_ROUNDS;
  return completedRounds >= memory.lastPromptRounds + REMINDER_AFTER_ROUNDS;
}

export const SURVEY_STORAGE_KEY = `corporate-ladder.feedback.${SURVEY_VERSION}`;
export const GUEST_TOKEN_STORAGE_KEY = "corporate-ladder.feedback-token";

export function parseMemory(raw: string | null): SurveyMemory {
  if (!raw) return EMPTY_MEMORY;
  try {
    const p = JSON.parse(raw) as Partial<SurveyMemory>;
    const count = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0);
    return { autoPrompts: count(p.autoPrompts), lastPromptRounds: count(p.lastPromptRounds), submittedAt: typeof p.submittedAt === "string" ? p.submittedAt : null };
  } catch {
    // A corrupt value counts as "already asked twice": never nag.
    return { autoPrompts: MAX_AUTO_PROMPTS, lastPromptRounds: 0, submittedAt: null };
  }
}
