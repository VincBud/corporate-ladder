/**
 * Live integration tests: real Supabase Auth, PostgREST, Postgres and the
 * running Next.js app. Opt-in via `npm run test:live`.
 *
 * Requires .env.local (staging project keys) and, for the HTTP tests,
 * LIVE_BASE_URL pointing at a running build of the app configured with the
 * same project. Creates test users and deletes them afterwards.
 * Never run this against production.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { xpForScore } from "@/career/xp";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { challengeFor } from "@/server/rounds/rules";
import type { CareerResponse } from "@/types/cloud-career";
import type { HintResponse, StartRoundResponse, SubmitRoundResponse } from "@/types/verified-play";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE = process.env.LIVE_BASE_URL ?? "";
const configured = Boolean(URL_ && PUBLISHABLE && SECRET);
const PASSWORD = `Live-${Math.random().toString(36).slice(2)}-Pw1!`;

const admin: SupabaseClient | null = configured
  ? createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const createdUsers: string[] = [];

interface TestUser {
  id: string;
  email: string;
  session: Session;
  db: SupabaseClient;
}

async function createUser(label: string): Promise<TestUser> {
  const email = `cl-live-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data, error } = await admin!.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Live ${label}` },
  });
  if (error) throw error;
  createdUsers.push(data.user.id);
  const anon = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw signIn.error;
  const session = signIn.data.session;
  const db = createClient(URL_, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  return { id: data.user.id, email, session, db };
}

/** Session cookies exactly as @supabase/ssr writes them (base64url, chunked at 3180). */
function sessionCookie(session: Session): string {
  const ref = new URL(URL_).hostname.split(".")[0];
  const key = `sb-${ref}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  if (value.length <= 3180) return `${key}=${value}`;
  const chunks: string[] = [];
  for (let i = 0; i * 3180 < value.length; i++) chunks.push(`${key}.${i}=${value.slice(i * 3180, (i + 1) * 3180)}`);
  return chunks.join("; ");
}

async function api<T>(user: TestUser | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { Cookie: sessionCookie(user.session) } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
}

/** Test-only: read the secret seed with the service role to know the answers. */
async function answersFor(sessionId: string, userId: string) {
  const { data, error } = await admin!.rpc("get_game_session", { p_session_id: sessionId, p_user_id: userId });
  if (error) throw error;
  const challenge = challengeFor(data.rules_version, data.seed);
  return {
    challenge,
    entries: (count = 5) =>
      Object.fromEntries(challenge.errors.slice(0, count).map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution])),
  };
}

async function ledgerRows(userId: string): Promise<number> {
  const { count, error } = await admin!.from("xp_ledger").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

async function shiftClock(sessionId: string, elapsedMs: number) {
  const now = Date.now();
  const { error } = await admin!
    .from("game_sessions")
    .update({ started_at: new Date(now - elapsedMs).toISOString(), deadline_at: new Date(now - elapsedMs + 90_000).toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

afterAll(async () => {
  for (const id of createdUsers) await admin?.auth.admin.deleteUser(id);
});

describe.skipIf(!configured)("live: database security through Supabase", () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
  });

  it("creates a profile with an employee number for each new user", async () => {
    const { data, error } = await alice.db.from("profiles").select("user_id, employee_number, display_name");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ user_id: alice.id, display_name: "Live alice" });
    expect(data![0].employee_number).toMatch(/^CL-\d{6}$/);
  });

  it("lets players edit only their own name and department", async () => {
    const ok = await alice.db.from("profiles").update({ display_name: "Alice Live" }).eq("user_id", alice.id).select();
    expect(ok.error).toBeNull();
    expect(ok.data![0].display_name).toBe("Alice Live");
    const number = await alice.db.from("profiles").update({ employee_number: "CL-000001" }).eq("user_id", alice.id);
    expect(number.error?.message).toMatch(/permission denied/);
    const other = await alice.db.from("profiles").update({ display_name: "Hacked" }).eq("user_id", bob.id).select();
    expect(other.data ?? []).toHaveLength(0);
  });

  it("hides sessions and blocks direct XP or result writes", async () => {
    expect((await alice.db.from("game_sessions").select("seed")).error?.message).toMatch(/permission denied/);
    const xp = await alice.db.from("xp_ledger").insert({ user_id: alice.id, source_type: "game_result", source_id: crypto.randomUUID(), amount: 9999 });
    expect(xp.error?.message).toMatch(/permission denied/);
    const finalize = await alice.db.rpc("finalize_game_session", { p_session_id: crypto.randomUUID(), p_user_id: alice.id, p_result: {}, p_submission: {} });
    expect(finalize.error).not.toBeNull();
    const create = await alice.db.rpc("create_game_session", { p_user_id: alice.id, p_game_id: "reconciliation-rush", p_seed: "RV1-forged-seed-value" });
    expect(create.error).not.toBeNull();
    expect((await alice.db.rpc("get_my_career_xp")).data).toBe(0);
  });

  it("gives anonymous visitors only reference data", async () => {
    const anon = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
    expect((await anon.from("departments").select("id")).data).toHaveLength(8);
    const profiles = await anon.from("profiles").select("*");
    expect(profiles.error !== null || (profiles.data ?? []).length === 0).toBe(true);
  });
});

describe.skipIf(!configured || !BASE)("live: verified rounds over HTTP", () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeAll(async () => {
    alice = await createUser("player");
    bob = await createUser("rival");
  });

  it("requires a valid session", async () => {
    expect((await api(null, "POST", "/api/rounds")).status).toBe(401);
    const forged = { ...alice.session, access_token: `${alice.session.access_token.slice(0, -4)}AAAA` };
    expect((await api({ ...alice, session: forged }, "POST", "/api/rounds")).status).toBe(401);
  });

  it("plays a full round: public puzzle, server hint, verified score and XP", async () => {
    const start = await api<StartRoundResponse>(alice, "POST", "/api/rounds");
    expect(start.status).toBe(200);
    expect(JSON.stringify(start.data)).not.toContain('"solution"');
    const { challenge, entries } = await answersFor(start.data.sessionId, alice.id);
    expect(JSON.stringify(start.data)).not.toContain(challenge.seed);

    const hint = await api<HintResponse>(alice, "POST", `/api/rounds/${start.data.sessionId}/hint`, { entries: entries(4) });
    expect(hint.status).toBe(200);
    expect(hint.data.hint.errorId).toBe(challenge.errors[4].id);

    const submit = await api<SubmitRoundResponse>(alice, "POST", `/api/rounds/${start.data.sessionId}/submit`, {
      entries: entries(),
      score: 1, // ignored
      xpAwarded: 99999, // ignored
    });
    expect(submit.status).toBe(200);
    expect(submit.data.created).toBe(true);
    expect(submit.data.record.errorsFixed).toBe(5);
    expect(submit.data.record.assistanceUsed).toBe(true);
    expect(submit.data.record.xpAwarded).toBe(xpForScore(submit.data.record.score));

    const career = await api<CareerResponse>(alice, "GET", "/api/career");
    expect(career.status).toBe(200);
    expect(career.data.totalXp).toBe(submit.data.record.xpAwarded);
    expect(career.data.records.map((r) => r.id)).toContain(start.data.sessionId);

    // Retrying returns the stored result and awards nothing more.
    const again = await api<SubmitRoundResponse>(alice, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: {} });
    expect(again.data.created).toBe(false);
    expect(again.data.record).toEqual(submit.data.record);
    expect(await ledgerRows(alice.id)).toBe(1);
  });

  it("finalizes truly concurrent submissions exactly once", async () => {
    const start = await api<StartRoundResponse>(alice, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, alice.id);
    const before = await ledgerRows(alice.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => api<SubmitRoundResponse>(alice, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries(i % 6) })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.data.created)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.data.record))).size).toBe(1);
    expect(await ledgerRows(alice.id)).toBe(before + 1);
  });

  it("refuses another player's round", async () => {
    const start = await api<StartRoundResponse>(alice, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, alice.id);
    expect((await api(bob, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() })).status).toBe(404);
    expect((await api(bob, "POST", `/api/rounds/${start.data.sessionId}/hint`, { entries: {} })).status).toBe(404);
    expect(await ledgerRows(bob.id)).toBe(0);
  });

  it("rejects malformed payloads", async () => {
    const start = await api<StartRoundResponse>(bob, "POST", "/api/rounds");
    const path = `/api/rounds/${start.data.sessionId}/submit`;
    expect((await api(bob, "POST", path, { entries: { "0:0": "INV-1" } })).status).toBe(400);
    expect((await api(bob, "POST", path, { entries: [] })).status).toBe(400);
    expect((await api(bob, "POST", path, "{not json")).status).toBe(400);
    expect((await api(bob, "POST", path, { entries: {}, pad: "x".repeat(20_000) })).status).toBe(400);
    expect((await api(bob, "POST", "/api/rounds/not-a-uuid/submit", { entries: {} })).status).toBe(400);
  });

  it("enforces the deadline with server time", async () => {
    const late = await api<StartRoundResponse>(bob, "POST", "/api/rounds");
    const lateAnswers = await answersFor(late.data.sessionId, bob.id);
    await shiftClock(late.data.sessionId, 120_000);
    const lateResult = await api<SubmitRoundResponse>(bob, "POST", `/api/rounds/${late.data.sessionId}/submit`, { entries: lateAnswers.entries() });
    expect(lateResult.data.record).toMatchObject({ completion: "timedOut", errorsFixed: 0, xpAwarded: 0 });

    const close = await api<StartRoundResponse>(bob, "POST", "/api/rounds");
    const closeAnswers = await answersFor(close.data.sessionId, bob.id);
    await shiftClock(close.data.sessionId, 91_000);
    const closeResult = await api<SubmitRoundResponse>(bob, "POST", `/api/rounds/${close.data.sessionId}/submit`, { entries: closeAnswers.entries() });
    expect(closeResult.data.record).toMatchObject({ completion: "timedOut", errorsFixed: 5, timeRemainingMs: 0 });
    expect(closeResult.data.review.score.timeBonus).toBe(0);
  });

  it("abandons an unfinished round when a new one starts", async () => {
    const first = await api<StartRoundResponse>(alice, "POST", "/api/rounds");
    await api<StartRoundResponse>(alice, "POST", "/api/rounds");
    expect((await api(alice, "POST", `/api/rounds/${first.data.sessionId}/submit`, { entries: {} })).status).toBe(409);
  });

  it("rate-limits round creation", async () => {
    const spammer = await createUser("spam");
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await api(spammer, "POST", "/api/rounds")).status);
    expect(statuses.slice(0, 12).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(12)).toContain(429);
  });

  it("imports guest history as legacy practice without XP, idempotently", async () => {
    const xpBefore = (await api<CareerResponse>(alice, "GET", "/api/career")).data.totalXp;
    const record = {
      id: "local-live-1", gameId: "reconciliation-rush", scoringVersion: 1, seed: "RR-LOCAL1", department: "IT", difficulty: "associate",
      completedAt: "2026-10-30T09:00:00.000Z", completion: "submitted", score: 700, maxScore: 1000, grade: "Meets Expectations",
      errorsFixed: 4, totalErrors: 5, incorrectCorrections: 0, accuracy: 1, timeUsedMs: 50000, timeRemainingMs: 40000, assistanceUsed: false, xpAwarded: 35,
    };
    expect((await api(alice, "POST", "/api/career/import", { records: [record] })).data).toEqual({ imported: 1, alreadyImported: 0, invalid: 0 });
    expect((await api(alice, "POST", "/api/career/import", { records: [record] })).data).toEqual({ imported: 0, alreadyImported: 1, invalid: 0 });
    const career = (await api<CareerResponse>(alice, "GET", "/api/career")).data;
    expect(career.legacy.map((l) => l.localId)).toContain("local-live-1");
    expect(career.totalXp).toBe(xpBefore);
  });

  it("updates the profile with validation", async () => {
    expect((await api(alice, "PATCH", "/api/profile", { displayName: "Alice Verified", departmentId: "finance" })).status).toBe(200);
    expect((await api(alice, "PATCH", "/api/profile", { displayName: "x" })).status).toBe(400);
    expect((await api(alice, "PATCH", "/api/profile", { departmentId: "nowhere" })).status).toBe(400);
    const career = (await api<CareerResponse>(alice, "GET", "/api/career")).data;
    expect(career.profile).toMatchObject({ displayName: "Alice Verified", departmentId: "finance" });
  });
});
