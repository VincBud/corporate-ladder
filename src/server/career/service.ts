import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRecord } from "@/performance/schema";
import type { CareerResponse, CloudProfile, LegacyRecord } from "@/types/cloud-career";
import type { GameResultRecord } from "@/types/progression";
import { RoundError } from "../rounds/errors";
import type { ResultRow, RpcCall } from "../rounds/round-store";
import { resultRowToRecord } from "../rounds/service";

const RESULT_COLUMNS =
  "session_id, user_id, game_id, rules_version, seed, department, difficulty, completion, score, max_score, grade, errors_fixed, total_errors, incorrect_corrections, accuracy, time_used_ms, time_remaining_ms, assistance_used, xp_awarded, completed_at";

const HISTORY_LIMIT = 500;
export const MAX_IMPORT_RECORDS = 200;

type ProfileRow = { user_id: string; employee_number: string; display_name: string; department_id: string | null; created_at: string };

const toProfile = (row: ProfileRow): CloudProfile => ({
  userId: row.user_id,
  employeeNumber: row.employee_number,
  displayName: row.display_name,
  departmentId: row.department_id,
  createdAt: row.created_at,
});

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/**
 * The signed-in player's career, read with their own session so Row Level
 * Security limits every query to their rows.
 */
export async function getCareer(supabase: SupabaseClient, userId: string): Promise<CareerResponse> {
  const [profile, results, legacy, xp, departments] = await Promise.all([
    supabase.from("profiles").select("user_id, employee_number, display_name, department_id, created_at").eq("user_id", userId).maybeSingle(),
    supabase.from("game_results").select(RESULT_COLUMNS).order("completed_at", { ascending: false }).limit(HISTORY_LIMIT),
    supabase.from("legacy_practice_results").select("local_id, summary, imported_at").order("played_at", { ascending: false }).limit(HISTORY_LIMIT),
    supabase.rpc("get_my_career_xp"),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  for (const response of [profile, results, legacy, xp, departments]) fail(response.error);
  if (!profile.data) throw new RoundError("unknown_player");

  const legacyRecords: LegacyRecord[] = [];
  for (const row of (legacy.data ?? []) as { local_id: string; summary: unknown; imported_at: string }[]) {
    const record = parseRecord(row.summary);
    if (record) legacyRecords.push({ localId: row.local_id, record, importedAt: row.imported_at });
  }

  return {
    profile: toProfile(profile.data as ProfileRow),
    totalXp: Number(xp.data ?? 0),
    records: ((results.data ?? []) as Omit<ResultRow, "submission">[]).map((row) => resultRowToRecord({ ...row, submission: {} })),
    legacy: legacyRecords,
    departments: (departments.data ?? []) as { id: string; name: string }[],
  };
}

/** Validates local guest summaries and stores them as unverified legacy practice. Idempotent. */
export async function importLegacy(rpc: RpcCall, userId: string, body: unknown) {
  const raw = typeof body === "object" && body !== null ? (body as { records?: unknown }).records : undefined;
  if (!Array.isArray(raw) || raw.length > MAX_IMPORT_RECORDS) throw new RoundError("invalid_payload", "Expected up to 200 records.");
  const valid: GameResultRecord[] = raw.map(parseRecord).filter((r): r is GameResultRecord => r !== null);
  const imported = valid.length ? Number(await rpc("import_legacy_results", { p_user_id: userId, p_records: valid })) : 0;
  return { imported, alreadyImported: valid.length - imported, invalid: raw.length - valid.length };
}

const CONTROL_CHARACTERS = /\p{Cc}/u;

/** Updates editable profile fields as the player (column grants + RLS apply). */
export async function updateProfile(supabase: SupabaseClient, userId: string, body: unknown): Promise<CloudProfile> {
  if (typeof body !== "object" || body === null) throw new RoundError("invalid_payload");
  const input = body as { displayName?: unknown; departmentId?: unknown };
  const patch: Record<string, string | null> = {};

  if (input.displayName !== undefined) {
    const name = typeof input.displayName === "string" ? input.displayName.trim() : "";
    if (name.length < 2 || name.length > 40 || CONTROL_CHARACTERS.test(name)) {
      throw new RoundError("invalid_payload", "Display names need 2–40 characters.");
    }
    patch.display_name = name;
  }
  if (input.departmentId !== undefined) {
    if (input.departmentId !== null && (typeof input.departmentId !== "string" || !/^[a-z][a-z0-9-]{1,30}$/.test(input.departmentId))) {
      throw new RoundError("invalid_payload", "Unknown department.");
    }
    patch.department_id = input.departmentId as string | null;
  }
  if (Object.keys(patch).length === 0) throw new RoundError("invalid_payload", "Nothing to update.");

  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", userId)
    .select("user_id, employee_number, display_name, department_id, created_at")
    .maybeSingle();
  if (error) throw new RoundError("invalid_payload", error.code === "23503" ? "Unknown department." : "Could not update the profile.");
  if (!data) throw new RoundError("unknown_player");
  return toProfile(data as ProfileRow);
}
