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
import { periodOf } from "@/simulation/periods";
import { solveRound } from "@/games/pipeline-panic/solve";
import { pipelineRoundFor } from "@/server/pipeline/rules";
import type { PipelineHintResponse, StartPipelineResponse, SubmitPipelineResponse } from "@/types/pipeline-play";
import { parseCompanySnapshot, type CompanySnapshot } from "@/simulation/source";
import { ACHIEVEMENTS } from "@/career/achievements";
import type { CareerResponse } from "@/types/cloud-career";
import type { SelectDepartmentResponse } from "@/types/department-career";
import type { ApiErrorBody, HintResponse, StartRoundResponse, SubmitRoundResponse } from "@/types/verified-play";

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

/** Test accounts (app_metadata.test_account) never count as company employees. */
async function createUser(label: string, { testAccount = true }: { testAccount?: boolean } = {}): Promise<TestUser> {
  const email = `cl-live-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data, error } = await admin!.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `Live ${label}` },
    app_metadata: testAccount ? { test_account: true } : {},
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
    expect((await anon.from("departments").select("id")).data).toHaveLength(9);
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

  it("updates the profile with validation (departments change only through a transfer)", async () => {
    expect((await api(alice, "PATCH", "/api/profile", { displayName: "Alice Verified" })).status).toBe(200);
    expect((await api(alice, "PATCH", "/api/profile", { displayName: "x" })).status).toBe(400);
    expect((await api(alice, "PATCH", "/api/profile", { departmentId: "finance" })).status).toBe(400);
    const career = (await api<CareerResponse>(alice, "GET", "/api/career")).data;
    expect(career.profile).toMatchObject({ displayName: "Alice Verified", departmentId: null });
  });
});

async function contributionEvents(userId: string) {
  const { data, error } = await admin!.from("contribution_events").select("*").eq("user_id", userId).order("completed_at");
  if (error) throw error;
  return data as { session_id: string; period_id: string; completed_at: string; completion: string; source: string; score: number; formula_version: number }[];
}

describe.skipIf(!configured)("live: contribution ledger security", () => {
  let carol: TestUser;
  beforeAll(async () => {
    carol = await createUser("carol");
  });

  it("publishes the canonical departments and the Reconciliation Rush allocation", async () => {
    const anon = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
    const departments = await anon.from("departments").select("id, kind").order("id");
    expect(departments.data).toContainEqual({ id: "controlling", kind: "operating" });
    expect(departments.data).toContainEqual({ id: "legal", kind: "support" });
    const allocation = await anon
      .from("contribution_allocations")
      .select("metric_id, department_id, weight_bp")
      .eq("game_id", "reconciliation-rush")
      .eq("formula_version", 1)
      .order("metric_id");
    expect(allocation.data).toEqual([
      { metric_id: "close-quality", department_id: "finance", weight_bp: 3000 },
      { metric_id: "ledger-integrity", department_id: "controlling", weight_bp: 7000 },
    ]);
  });

  it("hides events from players and blocks every client write", async () => {
    expect((await carol.db.from("contribution_events").select("*")).error?.message).toMatch(/permission denied/);
    const forged = await carol.db.from("contribution_events").insert({ session_id: crypto.randomUUID(), user_id: carol.id });
    expect(forged.error?.message).toMatch(/permission denied/);
    expect((await carol.db.rpc("backfill_contribution_events", { p_limit: 10 })).error).not.toBeNull();
    expect((await carol.db.rpc("record_contribution_event", { p_session_id: crypto.randomUUID(), p_source: "finalize" })).error).not.toBeNull();
    const formula = await carol.db.from("contribution_formulas").update({ is_active: false }).eq("game_id", "reconciliation-rush");
    expect(formula.error?.message).toMatch(/permission denied/);
  });

  it("doesn't let even the service role write events directly", async () => {
    const insert = await admin!.from("contribution_events").insert({ session_id: crypto.randomUUID(), user_id: carol.id });
    expect(insert.error?.message).toMatch(/permission denied/);
    const del = await admin!.from("contribution_events").delete().eq("user_id", carol.id);
    expect(del.error?.message).toMatch(/permission denied/);
    expect((await admin!.rpc("record_contribution_event", { p_session_id: crypto.randomUUID(), p_source: "finalize" })).error).not.toBeNull();
  });

  it("runs the backfill idempotently", async () => {
    const first = await admin!.rpc("backfill_contribution_events", { p_limit: 500 });
    expect(first.error).toBeNull();
    const second = await admin!.rpc("backfill_contribution_events", { p_limit: 500 });
    expect(second.data.created).toBe(0);
  });
});

describe.skipIf(!configured || !BASE)("live: verified company contributions over HTTP", () => {
  let dana: TestUser;
  let erin: TestUser;
  beforeAll(async () => {
    dana = await createUser("dana");
    erin = await createUser("erin");
  });

  it("records one event per verified round, with a database-assigned quarter", async () => {
    const start = await api<StartRoundResponse>(dana, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, dana.id);
    const submit = await api<SubmitRoundResponse>(dana, "POST", `/api/rounds/${start.data.sessionId}/submit`, {
      entries: entries(),
      completedAt: "2020-01-01T00:00:00.000Z", // ignored
      periodId: "2020-Q1", // ignored
    });
    expect(submit.status).toBe(200);
    // The player only learns that the round counted: no points or allocation.
    expect(submit.data.contribution).toEqual({ recorded: true });
    const [event] = await contributionEvents(dana.id);
    expect(event).toMatchObject({ session_id: start.data.sessionId, completion: "submitted", source: "finalize", score: submit.data.record.score, formula_version: 1 });
    expect(new Date(event.completed_at).toISOString()).toBe(submit.data.record.completedAt);
    expect(event.period_id).toBe(periodOf(submit.data.record.completedAt));
    expect(submit.data.record.xpAwarded).toBe(xpForScore(submit.data.record.score));

    const again = await api<SubmitRoundResponse>(dana, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: {} });
    expect(again.data.created).toBe(false);
    expect(await contributionEvents(dana.id)).toHaveLength(1);
  });

  it("records exactly one event for truly concurrent submissions", async () => {
    const start = await api<StartRoundResponse>(dana, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, dana.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => api<SubmitRoundResponse>(dana, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries(i % 6) })),
    );
    expect(results.filter((r) => r.data.created)).toHaveLength(1);
    expect((await contributionEvents(dana.id)).filter((e) => e.session_id === start.data.sessionId)).toHaveLength(1);
    expect(await ledgerRows(dana.id)).toBe(2);
  });

  it("records timed-out rounds and nothing for someone else's round", async () => {
    const start = await api<StartRoundResponse>(erin, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, erin.id);
    expect((await api(dana, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() })).status).toBe(404);
    await shiftClock(start.data.sessionId, 120_000);
    const late = await api<SubmitRoundResponse>(erin, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() });
    expect(late.data.record.completion).toBe("timedOut");
    expect(await contributionEvents(erin.id)).toEqual([expect.objectContaining({ session_id: start.data.sessionId, completion: "timedOut", score: 0 })]);
    expect((await contributionEvents(dana.id)).map((e) => e.session_id)).not.toContain(start.data.sessionId);
  });

  it("removes a player's events when the account is deleted", async () => {
    const leaver = await createUser("leaver");
    const start = await api<StartRoundResponse>(leaver, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, leaver.id);
    await api(leaver, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() });
    expect(await contributionEvents(leaver.id)).toHaveLength(1);
    const { error } = await admin!.auth.admin.deleteUser(leaver.id);
    expect(error).toBeNull();
    expect(await contributionEvents(leaver.id)).toHaveLength(0);
  });
});

async function companySnapshot(): Promise<CompanySnapshot> {
  const { status, data } = await api<unknown>(null, "GET", "/api/company");
  expect(status).toBe(200);
  const snapshot = parseCompanySnapshot(data);
  expect(snapshot).not.toBeNull();
  return snapshot!;
}

/** The server caches snapshots briefly; wait until a condition holds. */
async function eventually(check: (s: CompanySnapshot) => boolean, timeoutMs = 25_000): Promise<CompanySnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await companySnapshot();
    if (check(snapshot) || Date.now() > deadline) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

describe.skipIf(!configured)("live: company data access", () => {
  it("keeps the company data function away from clients", async () => {
    const user = await createUser("frank");
    expect((await user.db.rpc("get_company_quarter", { p_period_id: null })).error).not.toBeNull();
    const anon = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
    expect((await anon.rpc("get_company_quarter", { p_period_id: null })).error).not.toBeNull();
  });
});

describe.skipIf(!configured || !BASE)("live: company snapshot over HTTP", () => {
  it("serves a valid, aggregate-only snapshot to anyone, uncached", async () => {
    const response = await fetch(`${BASE}/api/company`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const snapshot = parseCompanySnapshot(JSON.parse(text))!;
    expect(snapshot.fictional).toBe(true);
    expect(snapshot.period.id).toBe(periodOf(new Date().toISOString()));
    expect(text).not.toMatch(/user_id|session_id|"seed"|@example\.com/);
    expect((await api(null, "GET", "/api/company?period=2025-Q1")).status).toBe(400);
  });

  it("ignores test accounts", async () => {
    const before = await companySnapshot();
    const tester = await createUser("company-tester");
    const start = await api<StartRoundResponse>(tester, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, tester.id);
    const submit = await api<SubmitRoundResponse>(tester, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() });
    expect(submit.data.contribution).toEqual({ recorded: true }); // recorded in the ledger…
    const after = await companySnapshot();
    expect(after.employees.registered).toBe(before.employees.registered); // …but not a company employee
    expect(after.employees.active).toBe(before.employees.active);
    expect(after.financials.revenue).toBe(before.financials.revenue);
  });

  it("shows a real employee's verified round right after it's submitted, and forgets it when the account is deleted", async () => {
    const before = await companySnapshot();
    const employee = await createUser("company-employee", { testAccount: false });
    const start = await api<StartRoundResponse>(employee, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, employee.id);
    const submit = await api<SubmitRoundResponse>(employee, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() });
    expect(submit.data.contribution).toEqual({ recorded: true });
    expect(submit.data.record.xpAwarded).toBe(xpForScore(submit.data.record.score));

    // The submit invalidated the server's cache, so the next read is fresh.
    const after = await companySnapshot();
    expect(after.employees.registered).toBe(before.employees.registered + 1);
    expect(after.employees.active).toBe(before.employees.active + 1);
    expect(after.dataStatus).toBe("active");
    expect(after.impact.revenue).toBeGreaterThan(before.impact.revenue);
    expect(after.departments.find((d) => d.id === "controlling")!.attainment).toBeGreaterThan(0);
    expect(new Date(after.lastContributionAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.stringify(after)).not.toContain(employee.id);

    const { error } = await admin!.auth.admin.deleteUser(employee.id);
    expect(error).toBeNull();
    const gone = await eventually((s) => s.employees.registered === before.employees.registered);
    expect(gone.employees.registered).toBe(before.employees.registered);
    expect(gone.employees.active).toBe(before.employees.active);
  }, 60_000);
});

describe.skipIf(!configured || !BASE)("live: authoritative data hardening", () => {
  it("blocks direct service-role writes to verified results, XP, sessions and profiles", async () => {
    const player = await createUser("hardening");
    const start = await api<StartRoundResponse>(player, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, player.id);
    await api(player, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() });

    const attempts = [
      admin!.from("game_results").update({ score: 1 }).eq("user_id", player.id),
      admin!.from("game_results").delete().eq("user_id", player.id),
      admin!.from("xp_ledger").insert({ user_id: player.id, source_type: "game_result", source_id: crypto.randomUUID(), amount: 999 }),
      admin!.from("xp_ledger").update({ amount: 999 }).eq("user_id", player.id),
      admin!.from("xp_ledger").delete().eq("user_id", player.id),
      admin!.from("game_sessions").update({ status: "active" }).eq("id", start.data.sessionId),
      admin!.from("game_sessions").delete().eq("id", start.data.sessionId),
      admin!.from("profiles").update({ employee_number: "CL-000001" }).eq("user_id", player.id),
      admin!.from("profiles").delete().eq("user_id", player.id),
      admin!.from("game_rules").update({ xp_score_divisor: 1 }).eq("game_id", "reconciliation-rush"),
    ];
    for (const attempt of attempts) expect((await attempt).error?.message).toMatch(/permission denied/);

    // A closed round's clock can't be moved either (owner-level guard).
    const late = await admin!.from("game_sessions").update({ deadline_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("id", start.data.sessionId);
    expect(late.error?.message).toMatch(/game_session_closed/);

    const { count } = await admin!.from("game_results").select("session_id", { count: "exact", head: true }).eq("user_id", player.id);
    expect(count).toBe(1);
    expect(await ledgerRows(player.id)).toBe(1);
  });

  it("still deletes a player's whole history with the account, consistently", async () => {
    const leaver = await createUser("hardening-leaver");
    const start = await api<StartRoundResponse>(leaver, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, leaver.id);
    await api(leaver, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() });
    expect((await admin!.auth.admin.deleteUser(leaver.id)).error).toBeNull();
    for (const table of ["game_sessions", "game_results", "xp_ledger", "contribution_events", "profiles"]) {
      const { count, error } = await admin!.from(table).select("*", { count: "exact", head: true }).eq("user_id", leaver.id);
      expect(error).toBeNull();
      expect(count, table).toBe(0);
    }
  });

  it("reports no orphaned or contradictory records after all of the above", async () => {
    const { data, error } = await admin!.rpc("check_progression_integrity");
    expect(error).toBeNull();
    expect(Object.values(data as Record<string, number>).every((n) => n === 0)).toBe(true);
  });
});

describe.skipIf(!configured || !BASE)("live: departments over HTTP", () => {
  const select = (user: TestUser | null, departmentId: string, requestId: string = crypto.randomUUID(), extra: object = {}) =>
    api<SelectDepartmentResponse & ApiErrorBody>(user, "POST", "/api/department", { departmentId, requestId, ...extra });

  it("requires a signed-in player", async () => {
    expect((await select(null, "finance")).status).toBe(401);
  });

  it("joins a department and reflects it in the profile and career", async () => {
    const quinn = await createUser("dept-quinn");
    const joined = await select(quinn, "controlling");
    expect(joined.status).toBe(200);
    expect(joined.data).toMatchObject({ status: "joined", membership: { departmentId: "controlling", startReason: "initial" } });
    const career = (await api<CareerResponse>(quinn, "GET", "/api/career")).data;
    expect(career.profile.departmentId).toBe("controlling");
    expect(career.departmentCareer.current?.departmentId).toBe("controlling");
    expect(career.departmentCareer.progress[0]).toMatchObject({ departmentId: "controlling", positionIndex: 0 });
    expect(career.departmentCareer.canTransferNow).toBe(false);
    const cooldown = Date.parse(career.departmentCareer.nextTransferAt!) - Date.parse(career.departmentCareer.current!.startedAt);
    expect(cooldown).toBe(30 * 86_400_000);
  });

  it("is idempotent per request and enforces the transfer cooldown on the server", async () => {
    const rae = await createUser("dept-rae");
    const requestId = crypto.randomUUID();
    expect((await select(rae, "finance", requestId)).data.status).toBe("joined");
    expect((await select(rae, "finance", requestId)).data.status).toBe("duplicate");
    const early = await select(rae, "sales", crypto.randomUUID(), { now: "2099-01-01T00:00:00Z", startedAt: "2000-01-01T00:00:00Z" });
    expect(early.status).toBe(409);
    expect(early.data.error.code).toBe("transfer_cooldown");
    expect((await select(rae, "finance")).data.error.code).toBe("already_member");
    expect((await select(rae, "space-force")).status).toBe(400);
    expect((await api(rae, "POST", "/api/department", { departmentId: "sales" })).status).toBe(400);
    const { data } = await rae.db.from("department_memberships").select("department_id, ended_at");
    expect(data).toEqual([{ department_id: "finance", ended_at: null }]);
  });

  it("lets only one of several concurrent first selections through", async () => {
    const sam = await createUser("dept-sam");
    const results = await Promise.all(["sales", "marketing", "it", "operations", "legal"].map((d) => select(sam, d)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    const { data } = await sam.db.from("department_memberships").select("id");
    expect(data).toHaveLength(1);
  });

  it("keeps membership history private and out of reach of direct writes", async () => {
    const tia = await createUser("dept-tia");
    const uma = await createUser("dept-uma");
    await select(tia, "people");
    await select(uma, "strategy");
    const own = await tia.db.from("department_memberships").select("user_id");
    expect(own.data).toEqual([{ user_id: tia.id }]);
    expect((await tia.db.from("department_memberships").insert({ user_id: tia.id, department_id: "sales", start_reason: "transfer" })).error?.message).toMatch(/permission denied/);
    expect((await tia.db.from("department_memberships").update({ department_id: "sales" }).eq("user_id", tia.id)).error?.message).toMatch(/permission denied/);
    expect((await tia.db.from("profiles").update({ department_id: "sales" }).eq("user_id", tia.id)).error?.message).toMatch(/permission denied/);
    expect((await admin!.from("profiles").update({ department_id: "sales" }).eq("user_id", tia.id)).error?.message).toMatch(/permission denied/);
    expect((await admin!.from("department_memberships").delete().eq("user_id", tia.id)).error?.message).toMatch(/permission denied/);
    expect((await tia.db.rpc("select_department", { p_user_id: tia.id, p_department_id: "sales", p_request_id: crypto.randomUUID() })).error).not.toBeNull();
  });

  it("counts verified rounds toward the department career without touching XP or contributions", async () => {
    const vic = await createUser("dept-vic");
    await select(vic, "controlling");
    const start = await api<StartRoundResponse>(vic, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, vic.id);
    const submit = await api<SubmitRoundResponse>(vic, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries() });
    const career = (await api<CareerResponse>(vic, "GET", "/api/career")).data;
    expect(career.departmentCareer.progress[0]).toMatchObject({ departmentId: "controlling", qualifyingRounds: 1, positionIndex: 0 });
    expect(career.totalXp).toBe(submit.data.record.xpAwarded);
    expect(await contributionEvents(vic.id)).toHaveLength(1);
  });

  it("deletes membership history with the account and leaves no inconsistencies", async () => {
    const wes = await createUser("dept-wes");
    await select(wes, "it");
    expect((await admin!.auth.admin.deleteUser(wes.id)).error).toBeNull();
    const { count } = await admin!.from("department_memberships").select("id", { count: "exact", head: true }).eq("user_id", wes.id);
    expect(count).toBe(0);
    const { data } = await admin!.rpc("check_progression_integrity");
    expect(Object.values(data as Record<string, number>).every((n) => n === 0)).toBe(true);
  });
});

async function pipelineAnswers(sessionId: string, userId: string) {
  const { data, error } = await admin!.rpc("get_game_session", { p_session_id: sessionId, p_user_id: userId });
  if (error) throw error;
  const round = pipelineRoundFor(data.rules_version, data.seed);
  return { round, decisions: Object.fromEntries(Object.entries(solveRound(round)).map(([id, r]) => [id, r.decision])) };
}

describe.skipIf(!configured || !BASE)("live: Pipeline Panic over HTTP", () => {
  it("plays a verified round: public pipeline, server hint, verified score, XP and one Sales contribution", async () => {
    const rep = await createUser("pp-rep");
    const start = await api<StartPipelineResponse>(rep, "POST", "/api/pipeline/rounds");
    expect(start.status).toBe(200);
    const { round, decisions } = await pipelineAnswers(start.data.sessionId, rep.id);
    expect(JSON.stringify(start.data)).not.toContain(round.seed);
    expect(JSON.stringify(start.data)).not.toContain("scenarios");

    const hint = await api<PipelineHintResponse>(rep, "POST", `/api/pipeline/rounds/${start.data.sessionId}/hint`, { decisions: {} });
    expect(hint.data.hint.opportunityId).toBe(round.opportunities[0].id);

    const submit = await api<SubmitPipelineResponse>(rep, "POST", `/api/pipeline/rounds/${start.data.sessionId}/submit`, { decisions, score: 1, xpAwarded: 9999 });
    expect(submit.status).toBe(200);
    expect(submit.data.record).toMatchObject({ gameId: "pipeline-panic", department: "Sales", errorsFixed: round.opportunities.length, assistanceUsed: true });
    expect(submit.data.record.xpAwarded).toBe(xpForScore(submit.data.record.score));
    expect(submit.data.contribution).toEqual({ recorded: true });
    const [event] = await contributionEvents(rep.id);
    expect(event).toMatchObject({ session_id: start.data.sessionId, formula_version: 1 });

    const career = (await api<CareerResponse>(rep, "GET", "/api/career")).data;
    expect(career.records[0]).toMatchObject({ gameId: "pipeline-panic", id: start.data.sessionId });
    expect(career.totalXp).toBe(submit.data.record.xpAwarded);
  });

  it("never sends answers for opportunities the player didn't attempt", async () => {
    const rep = await createUser("pp-redact");
    const start = await api<StartPipelineResponse>(rep, "POST", "/api/pipeline/rounds");
    const { round, decisions } = await pipelineAnswers(start.data.sessionId, rep.id);
    const firstTwo = Object.fromEntries(Object.entries(decisions).slice(0, 2));
    const response = await fetch(`${BASE}/api/pipeline/rounds/${start.data.sessionId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie(rep.session) },
      body: JSON.stringify({ decisions: firstTwo }),
    });
    const text = await response.text();
    const body = JSON.parse(text) as SubmitPipelineResponse;
    expect(text).not.toContain(round.seed);
    expect(JSON.stringify(body.review)).not.toMatch(/"scenarios"|"resolution"|"difficulty"/);
    const career = await api(rep, "GET", "/api/career");
    expect(JSON.stringify(career.data)).not.toContain(round.seed);
    const hidden = body.review.outcomes.filter((o) => o.kind === "undecided");
    expect(hidden).toHaveLength(round.opportunities.length - 2);
    for (const o of hidden) expect(Object.keys(o).sort()).toEqual(["decision", "id", "kind"]);
    expect(body.record.xpAwarded).toBe(xpForScore(body.record.score));
  });

  it("finalizes duplicate and concurrent submissions exactly once", async () => {
    const rep = await createUser("pp-concurrent");
    const start = await api<StartPipelineResponse>(rep, "POST", "/api/pipeline/rounds");
    const { decisions } = await pipelineAnswers(start.data.sessionId, rep.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => api<SubmitPipelineResponse>(rep, "POST", `/api/pipeline/rounds/${start.data.sessionId}/submit`, { decisions: i % 2 ? {} : decisions })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.data.created)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.data.record))).size).toBe(1);
    expect(await ledgerRows(rep.id)).toBe(1);
    expect(await contributionEvents(rep.id)).toHaveLength(1);
  });

  it("rejects tampered submissions and keeps games apart", async () => {
    const rep = await createUser("pp-tamper");
    const start = await api<StartPipelineResponse>(rep, "POST", "/api/pipeline/rounds");
    const path = `/api/pipeline/rounds/${start.data.sessionId}/submit`;
    expect((await api(rep, "POST", path, { decisions: { "opp-99": { action: "close" } } })).status).toBe(400);
    expect((await api(rep, "POST", path, { decisions: { "opp-1": { action: "discount", discount: 12 } } })).status).toBe(400);
    expect((await api(rep, "POST", path, { decisions: [] })).status).toBe(400);
    // A Pipeline Panic round can't be submitted to Reconciliation Rush, nor the other way round.
    expect((await api(rep, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: {} })).status).toBe(404);
    const rush = await api<StartRoundResponse>(rep, "POST", "/api/rounds");
    expect((await api(rep, "POST", `/api/pipeline/rounds/${rush.data.sessionId}/submit`, { decisions: {} })).status).toBe(404);
    expect(await ledgerRows(rep.id)).toBe(0);
  });

  it("enforces the deadline with server time", async () => {
    const rep = await createUser("pp-late");
    const start = await api<StartPipelineResponse>(rep, "POST", "/api/pipeline/rounds");
    const { decisions } = await pipelineAnswers(start.data.sessionId, rep.id);
    await shiftClock(start.data.sessionId, 120_000);
    const late = await api<SubmitPipelineResponse>(rep, "POST", `/api/pipeline/rounds/${start.data.sessionId}/submit`, { decisions });
    expect(late.data.record).toMatchObject({ completion: "timedOut", errorsFixed: 0, score: 0, xpAwarded: 0 });
  });

  it("advances the Sales career and makes Sales a measured department", async () => {
    const rep = await createUser("pp-career");
    await api(rep, "POST", "/api/department", { departmentId: "sales", requestId: crypto.randomUUID() });
    for (let i = 0; i < 3; i++) {
      const start = await api<StartPipelineResponse>(rep, "POST", "/api/pipeline/rounds");
      const { decisions } = await pipelineAnswers(start.data.sessionId, rep.id);
      await api(rep, "POST", `/api/pipeline/rounds/${start.data.sessionId}/submit`, { decisions });
    }
    const career = (await api<CareerResponse>(rep, "GET", "/api/career")).data;
    expect(career.departmentCareer.progress[0]).toMatchObject({ departmentId: "sales", positionIndex: 1, qualifyingRounds: 3 });
    const snapshot = await companySnapshot();
    expect(snapshot.formulaVersions).toContainEqual({ gameId: "pipeline-panic", formulaVersion: 1 });
    // Test accounts aren't employees; with no employees no department has a target yet.
    expect(snapshot.departments.find((d) => d.id === "sales")!.measured).toBe(snapshot.employees.registered > 0);
    const { data } = await admin!.rpc("check_progression_integrity");
    expect(Object.values(data as Record<string, number>).every((n) => n === 0)).toBe(true);
  });
});

describe.skipIf(!configured || !BASE)("live: achievements", () => {
  async function unlocks(userId: string) {
    const { data, error } = await admin!.from("player_achievements").select("achievement_id, source_type, source_id, unlocked_at").eq("user_id", userId);
    if (error) throw error;
    return data;
  }

  async function playRush(user: TestUser, fixed = 5) {
    const start = await api<StartRoundResponse>(user, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, user.id);
    const submit = await api<SubmitRoundResponse>(user, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries(fixed) });
    return { sessionId: start.data.sessionId, submit };
  }

  it("publishes the registry's definitions to everyone and nothing else", async () => {
    const anon = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
    const { data } = await anon.from("achievement_definitions").select("id, category, rarity, status");
    expect([...(data ?? [])].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      ACHIEVEMENTS.map(({ id, category, rarity, status }) => ({ id, category, rarity, status })).sort((a, b) => a.id.localeCompare(b.id)),
    );
    const rows = await anon.from("player_achievements").select("*");
    expect(rows.error !== null || (rows.data ?? []).length === 0).toBe(true);
  });

  it("unlocks from a verified round once, reports it once and keeps it after a refresh", async () => {
    const ada = await createUser("ach-unlock");
    const { sessionId, submit } = await playRush(ada, 5);
    expect(submit.status).toBe(200);
    const created = (submit.data.achievements ?? []).map((u) => u.id).sort();
    expect(created).toContain("first-assignment");
    expect(created).toContain("clean-audit");

    const retry = await api<SubmitRoundResponse>(ada, "POST", `/api/rounds/${sessionId}/submit`, { entries: {} });
    expect(retry.data.created).toBe(false);
    expect(retry.data.achievements).toEqual([]);

    const career = (await api<CareerResponse>(ada, "GET", "/api/career")).data;
    expect(career.achievements?.newlyUnlocked).toEqual([]);
    expect(career.achievements?.summary.unlocked.map((u) => u.id).sort()).toEqual(created);
    expect(career.achievements?.summary.progress["getting-started"]).toEqual({ current: 1, target: 10 });
    const rows = await unlocks(ada.id);
    expect(rows.map((r) => r.achievement_id).sort()).toEqual(created);
    expect(rows.find((r) => r.achievement_id === "first-assignment")).toMatchObject({ source_type: "game_result", source_id: sessionId });
  });

  it("awards once across truly concurrent submissions and career loads", async () => {
    const cal = await createUser("ach-concurrent");
    const start = await api<StartRoundResponse>(cal, "POST", "/api/rounds");
    const { entries } = await answersFor(start.data.sessionId, cal.id);
    const responses = await Promise.all([
      ...Array.from({ length: 4 }, () => api<SubmitRoundResponse>(cal, "POST", `/api/rounds/${start.data.sessionId}/submit`, { entries: entries(5) })),
      ...Array.from({ length: 3 }, () => api<CareerResponse>(cal, "GET", "/api/career")),
    ]);
    const reported = responses.flatMap((r) => {
      const data = r.data as SubmitRoundResponse & CareerResponse;
      return (data.achievements && "summary" in data.achievements ? data.achievements.newlyUnlocked : (data.achievements as SubmitRoundResponse["achievements"])) ?? [];
    });
    const ids = reported.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual((await unlocks(cal.id)).map((r) => r.achievement_id).sort());
  });

  it("reports department and cross-game unlocks from their own routes", async () => {
    const eve = await createUser("ach-department");
    const joined = await api<SelectDepartmentResponse>(eve, "POST", "/api/department", { departmentId: "sales", requestId: crypto.randomUUID() });
    expect(joined.data.achievements?.map((u) => u.id)).toEqual(["welcome-aboard"]);
    await playRush(eve, 2);
    const start = await api<StartPipelineResponse>(eve, "POST", "/api/pipeline/rounds");
    const { decisions } = await pipelineAnswers(start.data.sessionId, eve.id);
    const pipeline = await api<SubmitPipelineResponse>(eve, "POST", `/api/pipeline/rounds/${start.data.sessionId}/submit`, { decisions });
    expect(pipeline.data.achievements?.map((u) => u.id)).toEqual(expect.arrayContaining(["cross-functional", "sales-excellence", "deal-maker"]));
  });

  it("blocks every client write and service-role writes outside the award function", async () => {
    const mal = await createUser("ach-forge");
    const insert = { user_id: mal.id, achievement_id: "corporate-veteran", unlocked_at: new Date().toISOString() };
    expect((await mal.db.from("player_achievements").insert(insert)).error?.message).toMatch(/permission denied/);
    expect((await mal.db.rpc("award_achievements", { p_user_id: mal.id, p_awards: [{ achievement_id: "corporate-veteran" }] })).error).not.toBeNull();
    expect((await mal.db.rpc("get_achievement_facts", { p_user_id: mal.id })).error).not.toBeNull();
    expect((await mal.db.from("achievement_definitions").update({ status: "available" }).eq("id", "daily-grind")).error?.message).toMatch(/permission denied/);
    expect((await admin!.from("player_achievements").insert(insert)).error?.message).toMatch(/permission denied/);
    // A forged source from someone else's round is rejected by the award function itself.
    const victim = await createUser("ach-victim");
    const { sessionId } = await playRush(victim, 5);
    const forged = await admin!.rpc("award_achievements", { p_user_id: mal.id, p_awards: [{ achievement_id: "clean-audit", source_type: "game_result", source_id: sessionId }] });
    expect(forged.error?.message).toMatch(/invalid_achievement_award/);
    expect(await unlocks(mal.id)).toEqual([]);
    // Players see only their own unlocks.
    expect((await mal.db.from("player_achievements").select("*").eq("user_id", victim.id)).data ?? []).toEqual([]);
    expect(((await victim.db.from("player_achievements").select("achievement_id")).data ?? []).length).toBeGreaterThan(0);
  });

  it("removes achievements with the account", async () => {
    const leaver = await createUser("ach-leaver");
    await playRush(leaver, 5);
    expect((await unlocks(leaver.id)).length).toBeGreaterThan(0);
    await admin!.auth.admin.deleteUser(leaver.id);
    expect(await unlocks(leaver.id)).toEqual([]);
    const { data } = await admin!.rpc("check_progression_integrity");
    expect(Object.values(data as Record<string, number>).every((n) => n === 0)).toBe(true);
  });
});
