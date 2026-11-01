/**
 * Alpha feedback against the real migrations in PGlite: guest and account
 * submissions, idempotency, revisions, validation, limits, privacy, access
 * control, append-only storage, erasure and account deletion.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { createRpcRoundStore } from "../rounds/round-store";
import { challengeFor } from "../rounds/rules";
import { createVerifiedRoundService } from "../rounds/service";
import { RoundError } from "../rounds/errors";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { feedbackStatus, respondentKey, submitFeedback } from "./service";

const denied = /permission denied/;
let t: TestDatabase;
let seed = 0;

beforeAll(async () => {
  t = await createTestDatabase();
}, 60_000);

const body = (overrides: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(),
  ratings: { gameplayFun: 7, easeOfUnderstanding: 6, playability: 8, replayAppeal: 5 },
  enjoyed: "The memos.",
  improve: "More games.",
  context: { gamesPlayed: ["reconciliation-rush"], completedRounds: 3, deviceCategory: "desktop" },
  ...overrides,
});

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(RoundError);
  expect((error as RoundError).code).toBe(code);
};

async function rows(key: string) {
  const { rows } = await t.admin.query<Record<string, unknown>>("select * from public.feedback_responses where respondent_key = $1 order by revision", [key]);
  return rows;
}

const report = async () =>
  (await t.serviceRpc("get_feedback_report", { p_survey_version: "alpha-1" })) as { total_submissions: number; responses: Record<string, unknown>[] };

describe("submissions", () => {
  it("stores a guest response grouped by a hash of the browser token, never the token itself", async () => {
    const token = crypto.randomUUID();
    const receipt = await submitFeedback(t.serviceRpc, null, body({ guestToken: token }));
    expect(receipt).toMatchObject({ status: "created", revision: 1 });
    const [row] = await rows(respondentKey(null, token));
    expect(row).toMatchObject({ session_kind: "guest", user_id: null, gameplay_fun: 7, enjoyed: "The memos.", games_played: ["reconciliation-rush"], completed_rounds: 3, device_category: "desktop" });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("requires a token from guests", async () => {
    await expectCode(submitFeedback(t.serviceRpc, null, body()), "invalid_payload");
  });

  it("takes an account's games and rounds from verified results, not the client", async () => {
    const ada = await t.createUser("fb-ada@example.com");
    const rounds = createVerifiedRoundService({ store: createRpcRoundStore(t.serviceRpc), createSeed: () => `RV1-feedback-${String(++seed).padStart(8, "0")}-x` });
    for (let i = 0; i < 2; i++) {
      const started = await rounds.startRound(ada);
      const { rows: s } = await t.admin.query<{ seed: string }>("select seed from public.game_sessions where id = $1", [started.sessionId]);
      const challenge = challengeFor(1, s[0].seed);
      const e = challenge.errors[0];
      await rounds.submitRound(ada, started.sessionId, { entries: { [cellKey(e.address)]: challenge.cells.get(cellKey(e.address))!.solution } });
    }
    const xpBefore = await t.admin.query("select coalesce(sum(amount), 0)::int as xp from public.xp_ledger where user_id = $1", [ada]);
    await submitFeedback(t.serviceRpc, ada, body({ context: { gamesPlayed: ["pipeline-panic"], completedRounds: 999, deviceCategory: "mobile" } }));
    const [row] = await rows(`user:${ada}`);
    expect(row).toMatchObject({ session_kind: "authenticated", user_id: ada, games_played: ["reconciliation-rush"], completed_rounds: 2, device_category: "mobile" });
    // Feedback earns nothing.
    expect((await t.admin.query("select coalesce(sum(amount), 0)::int as xp from public.xp_ledger where user_id = $1", [ada])).rows).toEqual(xpBefore.rows);
    expect((await t.admin.query("select 1 from public.player_achievements where user_id = $1", [ada])).rows).toEqual([]);
    expect(await feedbackStatus(t.serviceRpc, ada)).toMatchObject({ submitted: true, revision: 1 });
  });

  it("is idempotent per request: retries and double clicks create one response", async () => {
    const token = crypto.randomUUID();
    const request = body({ guestToken: token });
    const [a, b, c] = await Promise.all([submitFeedback(t.serviceRpc, null, request), submitFeedback(t.serviceRpc, null, request), submitFeedback(t.serviceRpc, null, request)]);
    expect([a, b, c].filter((r) => r.status === "created")).toHaveLength(1);
    expect(new Set([a, b, c].map((r) => r.revision))).toEqual(new Set([1]));
    expect(await rows(respondentKey(null, token))).toHaveLength(1);
  });

  it("refuses to reuse someone else's request id", async () => {
    const request = body({ guestToken: crypto.randomUUID() });
    await submitFeedback(t.serviceRpc, null, request);
    await expectCode(submitFeedback(t.serviceRpc, null, { ...request, guestToken: crypto.randomUUID() }), "invalid_payload");
  });

  it("treats a deliberate resubmission as a new revision that replaces the old one in the report", async () => {
    const bea = await t.createUser("fb-bea@example.com");
    await submitFeedback(t.serviceRpc, bea, body({ ratings: { gameplayFun: 2, easeOfUnderstanding: 2, playability: 2, replayAppeal: 2 } }));
    const second = await submitFeedback(t.serviceRpc, bea, body({ ratings: { gameplayFun: 9, easeOfUnderstanding: 9, playability: 9, replayAppeal: 9 } }));
    expect(second.revision).toBe(2);
    const mine = (await report()).responses.filter((r) => (r.ratings as Record<string, number>).gameplay_fun === 9 || (r.ratings as Record<string, number>).gameplay_fun === 2);
    expect(mine.map((r) => (r.ratings as Record<string, number>).gameplay_fun)).toEqual([9]);
    expect(await feedbackStatus(t.serviceRpc, bea)).toMatchObject({ submitted: true, revision: 2 });
  });
});

describe("validation and limits", () => {
  it("validates ratings and comment lengths on the server", async () => {
    await expectCode(submitFeedback(t.serviceRpc, null, body({ guestToken: crypto.randomUUID(), ratings: { gameplayFun: 11, easeOfUnderstanding: 6, playability: 8, replayAppeal: 5 } })), "invalid_payload");
    await expectCode(submitFeedback(t.serviceRpc, null, body({ guestToken: crypto.randomUUID(), improve: "x".repeat(1001) })), "invalid_payload");
    // The database rejects bad values even if a caller skips the TypeScript validation.
    await expect(
      t.serviceRpc("submit_feedback", {
        p_survey_version: "alpha-1",
        p_respondent_key: respondentKey(null, crypto.randomUUID()),
        p_user_id: null,
        p_request_id: crypto.randomUUID(),
        p_payload: { ratings: { gameplay_fun: 0, ease_of_understanding: 5, playability: 5, replay_appeal: 5 }, completed_rounds: 1, device_category: "desktop" },
      }),
    ).rejects.toThrow(/invalid_feedback/);
    await expect(
      t.serviceRpc("submit_feedback", {
        p_survey_version: "alpha-1",
        p_respondent_key: "user:00000000-0000-4000-8000-000000000000",
        p_user_id: null,
        p_request_id: crypto.randomUUID(),
        p_payload: {},
      }),
    ).rejects.toThrow(/invalid_feedback/);
  });

  it("limits revisions per guest token", async () => {
    const token = crypto.randomUUID();
    for (let i = 0; i < 5; i++) await submitFeedback(t.serviceRpc, null, body({ guestToken: token }));
    await expectCode(submitFeedback(t.serviceRpc, null, body({ guestToken: token })), "rate_limited");
  });

  it("caps guest submissions globally per hour", async () => {
    const db = await createTestDatabase();
    for (let i = 0; i < 60; i++) {
      await db.admin.query(
        `insert into public.feedback_responses (survey_version, respondent_key, revision, request_id, gameplay_fun, ease_of_understanding, playability, replay_appeal, completed_rounds, session_kind, device_category)
         values ('alpha-1', $1, 1, gen_random_uuid(), 5, 5, 5, 5, 3, 'guest', 'desktop')`,
        [respondentKey(null, crypto.randomUUID())],
      );
    }
    await expectCode(submitFeedback(db.serviceRpc, null, body({ guestToken: crypto.randomUUID() })), "rate_limited");
    const cal = await db.createUser("fb-cal@example.com");
    expect((await submitFeedback(db.serviceRpc, cal, body())).status).toBe("created"); // accounts aren't affected
  }, 60_000);
});

describe("privacy and access control", () => {
  it("keeps feedback away from every API role, including direct service-role access", async () => {
    const dan = await t.createUser("fb-dan@example.com");
    await submitFeedback(t.serviceRpc, dan, body());
    await expect(t.asUser(dan, (db) => db.query("select * from public.feedback_responses"))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query("select * from public.feedback_responses"))).rejects.toThrow(denied);
    await expect(t.asUser(dan, (db) => db.query("select public.get_feedback_report('alpha-1')"))).rejects.toThrow(denied);
    await expect(t.asUser(dan, (db) => db.query("select public.submit_feedback('alpha-1', $1, $2, gen_random_uuid(), '{}'::jsonb)", [`user:${dan}`, dan]))).rejects.toThrow(denied);
    await t.db.exec("set role service_role");
    try {
      await expect(t.db.query("select * from public.feedback_responses")).rejects.toThrow(denied);
      await expect(t.db.query("update public.feedback_responses set gameplay_fun = 10")).rejects.toThrow(denied);
    } finally {
      await t.db.exec("reset role");
    }
  });

  it("reports without respondent keys, user ids or tokens", async () => {
    const json = JSON.stringify(await report());
    expect(json).not.toMatch(/user:|guest:|user_id|respondent_key|@example\.com/);
  });

  it("is append-only, even for the owner", async () => {
    await expect(t.admin.query("update public.feedback_responses set gameplay_fun = 10")).rejects.toThrow(/append_only/);
    await expect(t.admin.query("delete from public.feedback_responses")).rejects.toThrow(/append_only/);
    await expect(t.admin.query("truncate public.feedback_responses")).rejects.toThrow(/append_only/);
  });

  it("erases one respondent on request, and an account's feedback with the account", async () => {
    const token = crypto.randomUUID();
    await submitFeedback(t.serviceRpc, null, body({ guestToken: token }));
    expect(await t.serviceRpc("delete_feedback_responses", { p_respondent_key: respondentKey(null, token) })).toBe(1);
    expect(await rows(respondentKey(null, token))).toEqual([]);
    const eve = await t.createUser("fb-eve@example.com");
    await submitFeedback(t.serviceRpc, eve, body());
    await t.admin.query("delete from auth.users where id = $1", [eve]);
    expect(await rows(`user:${eve}`)).toEqual([]);
  });
});
