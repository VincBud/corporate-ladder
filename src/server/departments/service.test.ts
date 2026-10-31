/**
 * Department membership against the real migrations in PGlite: joining,
 * transfers, cooldown, idempotency, concurrency, authorization, account
 * deletion and the effect on XP, contributions and the live company.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { summarizeDepartmentCareer, type MembershipRow } from "@/career/department-membership";
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import { createCompanyService } from "../company/service";
import { RoundError } from "../rounds/errors";
import { createRpcRoundStore, type ResultRow } from "../rounds/round-store";
import { challengeFor } from "../rounds/rules";
import { createVerifiedRoundService, resultRowToRecord, type VerifiedRoundService } from "../rounds/service";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { selectDepartment } from "./service";

const denied = /permission denied/;
let t: TestDatabase;
let rounds: VerifiedRoundService;
let seedCounter = 0;

beforeAll(async () => {
  t = await createTestDatabase();
  rounds = createVerifiedRoundService({
    store: createRpcRoundStore(t.serviceRpc),
    createSeed: () => `RV1-dept-${String(++seedCounter).padStart(8, "0")}-seed`,
  });
}, 60_000);

const join = (userId: string, departmentId: string, requestId: string = crypto.randomUUID()) =>
  selectDepartment(t.serviceRpc, userId, { departmentId, requestId });

async function memberships(userId: string): Promise<MembershipRow[]> {
  const { rows } = await t.admin.query<MembershipRow>(
    "select id, department_id, started_at, ended_at, start_reason, end_reason from public.department_memberships where user_id = $1 order by started_at, created_at",
    [userId],
  );
  return rows;
}

async function profileDepartment(userId: string) {
  const { rows } = await t.admin.query<{ department_id: string | null }>("select department_id from public.profiles where user_id = $1", [userId]);
  return rows[0].department_id;
}

/**
 * Moves the player's memberships, verified results and contribution events
 * into the past together, as if time passed (test arrangement only).
 */
async function backdate(userId: string, days: number, extraMs = 0) {
  const shift = "($2 * interval '1 day') - ($3 * interval '1 millisecond')";
  await t.arrange(
    `update public.department_memberships set started_at = started_at - ${shift}, ended_at = ended_at - ${shift} where user_id = $1`,
    [userId, days, extraMs],
  );
  await t.arrange(`update public.game_results set completed_at = completed_at - ${shift} where user_id = $1`, [userId, days, extraMs]);
  await t.arrange(`update public.contribution_events set completed_at = completed_at - ${shift} where user_id = $1`, [userId, days, extraMs]);
}

async function play(userId: string, fixed = 5) {
  const started = await rounds.startRound(userId);
  const { rows } = await t.admin.query<{ seed: string }>("select seed from public.game_sessions where id = $1", [started.sessionId]);
  const challenge = challengeFor(1, rows[0].seed);
  const entries = Object.fromEntries(challenge.errors.slice(0, fixed).map((e) => [cellKey(e.address), challenge.cells.get(cellKey(e.address))!.solution]));
  return rounds.submitRound(userId, started.sessionId, { entries });
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(RoundError);
  expect((error as RoundError).code).toBe(code);
};

describe("joining a department", () => {
  it("records the first selection immediately and updates the profile", async () => {
    const alice = await t.createUser("join-alice@example.com");
    const result = await join(alice, "controlling");
    expect(result).toMatchObject({ status: "joined", membership: { departmentId: "controlling", startReason: "initial", endedAt: null } });
    expect(Date.parse(result.nextTransferAt!) - Date.parse(result.membership.startedAt)).toBe(30 * 86_400_000);
    expect(await profileDepartment(alice)).toBe("controlling");
    expect(await memberships(alice)).toHaveLength(1);
  });

  it("returns the original result for a retried request and creates nothing new", async () => {
    const bob = await t.createUser("join-bob@example.com");
    const requestId = crypto.randomUUID();
    const first = await join(bob, "sales", requestId);
    const again = await join(bob, "sales", requestId);
    expect(again).toMatchObject({ status: "duplicate", membership: first.membership });
    // Even a retry naming another department returns the original result.
    expect((await join(bob, "legal", requestId)).status).toBe("duplicate");
    expect(await memberships(bob)).toHaveLength(1);
  });

  it("handles concurrent duplicate submissions as one", async () => {
    const carol = await t.createUser("join-carol@example.com");
    const requestId = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => join(carol, "marketing", requestId)));
    expect(results.filter((r) => r.status === "joined")).toHaveLength(1);
    expect(await memberships(carol)).toHaveLength(1);
  });

  it("rejects joining the same department again, unknown departments and bad requests", async () => {
    const dan = await t.createUser("join-dan@example.com");
    await join(dan, "it");
    await expectCode(join(dan, "it"), "already_member");
    await expectCode(join(dan, "space-force"), "unknown_department");
    await expectCode(selectDepartment(t.serviceRpc, dan, { departmentId: "it" }), "invalid_payload");
    await expectCode(selectDepartment(t.serviceRpc, dan, { departmentId: "it", requestId: "not-a-uuid" }), "invalid_payload");
    await expectCode(selectDepartment(t.serviceRpc, dan, null), "unknown_department");
  });

  it("won't let a player reuse someone else's request id", async () => {
    const erin = await t.createUser("join-erin@example.com");
    const frank = await t.createUser("join-frank@example.com");
    const requestId = crypto.randomUUID();
    await join(erin, "finance", requestId);
    await expectCode(join(frank, "finance", requestId), "invalid_payload");
    expect(await memberships(frank)).toHaveLength(0);
  });
});

describe("transfers", () => {
  it("enforce the 30-day cooldown with database time", async () => {
    const gina = await t.createUser("transfer-gina@example.com");
    await join(gina, "finance");
    await expectCode(join(gina, "sales"), "transfer_cooldown");
    await backdate(gina, 29, 23 * 3_600_000 + 59 * 60_000); // 29 days, 23 h 59 min
    await expectCode(join(gina, "sales"), "transfer_cooldown");
    await backdate(gina, 0, 2 * 60_000); // now just over 30 days
    const moved = await join(gina, "sales");
    expect(moved).toMatchObject({ status: "transferred", membership: { departmentId: "sales", startReason: "transfer" } });

    const history = await memberships(gina);
    expect(history.map((m) => [m.department_id, m.end_reason])).toEqual([["finance", "transfer"], ["sales", null]]);
    // The old period ends exactly when the new one starts.
    expect(new Date(history[0].ended_at!).getTime()).toBe(new Date(history[1].started_at).getTime());
    expect(await profileDepartment(gina)).toBe("sales");
    // A new cooldown starts with the new membership.
    await expectCode(join(gina, "finance"), "transfer_cooldown");
  });

  it("ignore client-supplied timestamps", async () => {
    const hank = await t.createUser("transfer-hank@example.com");
    await join(hank, "legal");
    await expectCode(
      selectDepartment(t.serviceRpc, hank, {
        departmentId: "strategy",
        requestId: crypto.randomUUID(),
        now: "2099-01-01T00:00:00Z",
        startedAt: "2000-01-01T00:00:00Z",
        nextTransferAt: "2000-01-01T00:00:00Z",
      }),
      "transfer_cooldown",
    );
  });

  it("let only one of several concurrent transfers through", async () => {
    const ivy = await t.createUser("transfer-ivy@example.com");
    await join(ivy, "people");
    await backdate(ivy, 31);
    const outcomes = await Promise.allSettled(["sales", "marketing", "it", "operations"].map((d) => join(ivy, d)));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const failures = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected").map((o) => (o.reason as RoundError).code);
    expect(new Set(failures)).toEqual(new Set(["transfer_cooldown"]));
    const history = await memberships(ivy);
    expect(history).toHaveLength(2);
    expect(history.filter((m) => m.ended_at === null)).toHaveLength(1);
  });

  it("support returning to a previous department, with the career resumed", async () => {
    const jo = await t.createUser("transfer-jo@example.com");
    await join(jo, "controlling");
    for (let i = 0; i < 3; i++) await play(jo); // three qualifying rounds in Controlling
    await backdate(jo, 31);
    await join(jo, "sales");
    await backdate(jo, 31);
    await join(jo, "controlling");

    const { rows } = await t.admin.query<ResultRow>("select * from public.game_results where user_id = $1", [jo]);
    const summary = summarizeDepartmentCareer(await memberships(jo), rows.map(resultRowToRecord), new Date());
    expect(summary.history.map((m) => m.departmentId)).toEqual(["controlling", "sales", "controlling"]);
    expect(summary.progress.find((p) => p.departmentId === "controlling")).toMatchObject({ positionIndex: 1, qualifyingRounds: 3 });
    expect(summary.progress.find((p) => p.departmentId === "sales")).toMatchObject({ positionIndex: 0 });
  });

  it("preserve Corporate XP, verified history and contribution events", async () => {
    const kim = await t.createUser("transfer-kim@example.com");
    await join(kim, "finance");
    await play(kim);
    await play(kim, 3);
    const snapshot = async () => {
      const { rows } = await t.admin.query(
        `select (select coalesce(sum(amount), 0)::int from public.xp_ledger where user_id = $1) as xp,
                (select count(*)::int from public.game_results where user_id = $1) as results,
                (select coalesce(jsonb_agg(to_jsonb(e) order by e.session_id), '[]') from public.contribution_events e where e.user_id = $1) as events`,
        [kim],
      );
      return rows[0];
    };
    await backdate(kim, 31);
    const before = await snapshot();
    await join(kim, "marketing");
    expect(await snapshot()).toEqual(before);
  });
});

describe("authorization and integrity", () => {
  it("lets players read only their own membership history", async () => {
    const lee = await t.createUser("auth-lee@example.com");
    const max = await t.createUser("auth-max@example.com");
    await join(lee, "finance");
    await join(max, "sales");
    const { rows } = await t.asUser(lee, (db) => db.query<{ user_id: string }>("select user_id from public.department_memberships"));
    expect(rows.map((r) => r.user_id)).toEqual([lee]);
    await expect(t.asAnon((db) => db.query("select * from public.department_memberships"))).rejects.toThrow(denied);
  });

  it("blocks every direct write by players, visitors and the service role", async () => {
    const ned = await t.createUser("auth-ned@example.com");
    await join(ned, "finance");
    const writes = [
      `insert into public.department_memberships (user_id, department_id, start_reason) values ('${ned}', 'sales', 'transfer')`,
      "update public.department_memberships set department_id = 'sales'",
      "update public.department_memberships set ended_at = now(), end_reason = 'transfer'",
      "delete from public.department_memberships",
      `update public.profiles set department_id = 'sales' where user_id = '${ned}'`,
      `select public.select_department('${ned}', 'sales', gen_random_uuid())`,
    ];
    for (const sql of writes) {
      await expect(t.asUser(ned, (db) => db.query(sql)), sql).rejects.toThrow(denied);
      await expect(t.asAnon((db) => db.query(sql)), sql).rejects.toThrow(denied);
    }
    for (const sql of writes.slice(0, 5)) {
      await t.db.exec("set role service_role");
      try {
        await expect(t.db.query(sql), sql).rejects.toThrow(denied);
      } finally {
        await t.db.exec("reset role");
      }
    }
    expect(await profileDepartment(ned)).toBe("finance");
  });

  it("guards history and the current department even against the database owner", async () => {
    const oz = await t.createUser("auth-oz@example.com");
    await join(oz, "finance");
    await expect(t.admin.query("update public.profiles set department_id = 'sales' where user_id = $1", [oz])).rejects.toThrow(/department_change_requires_membership/);
    await expect(t.admin.query("update public.profiles set department_id = null where user_id = $1", [oz])).rejects.toThrow(/department_change_requires_membership/);
    await expect(t.admin.query("update public.department_memberships set department_id = 'sales' where user_id = $1", [oz])).rejects.toThrow(/append_only/);
    await expect(t.admin.query("update public.department_memberships set started_at = now() - interval '1 year' where user_id = $1", [oz])).rejects.toThrow(/append_only/);
    await expect(t.admin.query("delete from public.department_memberships where user_id = $1", [oz])).rejects.toThrow(/append_only/);
    await expect(t.admin.query("truncate public.department_memberships")).rejects.toThrow(/append_only/);
    await expect(
      t.admin.query("insert into public.department_memberships (user_id, department_id, start_reason) values ($1, 'sales', 'transfer')", [oz]),
    ).rejects.toThrow(/duplicate key|overlap/);
    await expect(
      t.admin.query("insert into public.department_memberships (user_id, department_id, start_reason, started_at, ended_at, end_reason) values ($1, 'sales', 'transfer', now() - interval '2 days', now() + interval '1 day', 'transfer')", [oz]),
    ).rejects.toThrow(/overlap/);
  });

  it("removes membership history with the account, consistently", async () => {
    const pat = await t.createUser("auth-pat@example.com");
    await join(pat, "it");
    await play(pat);
    await backdate(pat, 31);
    await join(pat, "legal");
    await t.admin.query("delete from auth.users where id = $1", [pat]);
    expect(await memberships(pat)).toEqual([]);
    const integrity = (await t.serviceRpc("check_progression_integrity", {})) as Record<string, number>;
    expect(integrity).toMatchObject({ profiles_department_mismatch: 0, overlapping_memberships: 0 });
    expect(Object.values(integrity).every((n) => n === 0)).toBe(true);
  });
});

describe("live company workforce", () => {
  it("updates membership counts after joining and transferring, without changing company figures", async () => {
    const company = createCompanyService({ rpc: t.serviceRpc, ttlMs: 0 });
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => t.createUser(`workforce-${i}@example.com`)));
    const before = await company.getSnapshot();
    for (const id of ids) await join(id, "operations");
    const joined = await company.getSnapshot();
    expect(joined.employees.membership!.find((g) => g.id === "operations")!.count).toBe(6);
    expect(joined.employees.registered).toBe(before.employees.registered);
    // Membership is identity only: the company's figures don't move.
    expect(joined.financials).toEqual(before.financials);
    expect(joined.departments).toEqual(before.departments);

    await backdate(ids[0], 31);
    await join(ids[0], "legal");
    const after = await company.getSnapshot();
    expect(after.employees.membership!.find((g) => g.id === "operations")!.count).toBe(5);
    expect(after.financials).toEqual(joined.financials);
    expect(after.departments).toEqual(joined.departments);
  });
});
