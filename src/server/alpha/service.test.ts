/**
 * Closed alpha invitations against the real migrations in PGlite. Accounts
 * are inserted into auth.users exactly as Supabase Auth does, so the
 * enforcement trigger runs for every case (including "direct" sign-ups that
 * skip the app).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateInviteCode, inviteCodeHash, normalizeInviteCode } from "@/alpha/invite-code";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { checkInvitation, getAlphaAccess } from "./service";

const denied = /permission denied/;
let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
}, 60_000);

beforeEach(async () => {
  await t.serviceRpc("set_alpha_invite_required", { p_required: true });
});

async function invite(options: { days?: number; note?: string } = {}) {
  const code = generateInviteCode();
  const [row] = (await t.serviceRpc("create_alpha_invitations", {
    p_code_hashes: [inviteCodeHash(code)],
    p_expires_at: new Date(Date.now() + (options.days ?? 14) * 86_400_000).toISOString(),
    p_note: options.note ?? null,
  })) as { id: string }[];
  return { code, id: row.id };
}

/** Inserts an auth user the way Supabase Auth does (metadata from the sign-up request). */
async function signUp(email: string, meta: Record<string, unknown> = {}, app: Record<string, unknown> = {}) {
  const { rows } = await t.admin.query<{ id: string; raw_user_meta_data: Record<string, unknown> }>(
    "insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id, raw_user_meta_data",
    [email, JSON.stringify(meta), JSON.stringify(app)],
  );
  return rows[0];
}

async function invitation(id: string) {
  const { rows } = await t.admin.query<{ redeemed_at: Date | null; redeemed_by: string | null; revoked_at: Date | null }>(
    "select redeemed_at, redeemed_by, revoked_at from public.alpha_invitations where id = $1",
    [id],
  );
  return rows[0];
}

const userExists = async (email: string) => (await t.admin.query("select 1 from auth.users where email = $1", [email])).rows.length === 1;

describe("codes", () => {
  it("normalizes and hashes exactly like the database", async () => {
    const samples = [...Array.from({ length: 50 }, () => generateInviteCode()), "cl-7k2m-9qxa-4tob", " CL 7K2M 9QXA 4T0B ", "il1l-oo00-ab12-cd34", "CL-ABCD", ""];
    for (const sample of samples) {
      const { rows } = await t.admin.query<{ normalized: string; hash: string }>(
        "select public.normalize_alpha_invite_code($1) as normalized, public.alpha_invite_code_hash($1) as hash",
        [sample],
      );
      expect(rows[0]).toEqual({ normalized: normalizeInviteCode(sample), hash: inviteCodeHash(sample) });
    }
  });

  it("stores only hashes", async () => {
    const { code, id } = await invite();
    const { rows } = await t.admin.query("select * from public.alpha_invitations where id = $1", [id]);
    expect(JSON.stringify(rows)).not.toContain(normalizeInviteCode(code));
    expect(JSON.stringify(rows)).not.toContain(code);
  });
});

describe("registration enforcement", () => {
  it("keeps today's open sign-up while invitations aren't required", async () => {
    await t.serviceRpc("set_alpha_invite_required", { p_required: false });
    expect(await getAlphaAccess(t.serviceRpc)).toEqual({ inviteRequired: false });
    await signUp("open-signup@example.com", { display_name: "Open" });
    expect(await userExists("open-signup@example.com")).toBe(true);
  });

  it("refuses an account without an invitation once required (any sign-up path)", async () => {
    expect(await getAlphaAccess(t.serviceRpc)).toEqual({ inviteRequired: true });
    await expect(signUp("no-code@example.com", { display_name: "Nope" })).rejects.toThrow(/alpha_invitation_required/);
    expect(await userExists("no-code@example.com")).toBe(false);
    expect((await t.admin.query("select 1 from public.profiles p join auth.users u on u.id = p.user_id where u.email = 'no-code@example.com'")).rows).toEqual([]);
  });

  it("creates exactly one account per valid invitation and forgets the code", async () => {
    const { code, id } = await invite({ note: "tester 1" });
    expect(await checkInvitation(t.serviceRpc, code)).toBe(true);
    const user = await signUp("tester1@example.com", { display_name: "Tess", alpha_invite: code.toLowerCase() });
    expect(user.raw_user_meta_data).toEqual({ display_name: "Tess" });
    expect(await invitation(id)).toMatchObject({ redeemed_by: user.id });
    const { rows } = await t.admin.query<{ display_name: string }>("select display_name from public.profiles where user_id = $1", [user.id]);
    expect(rows[0].display_name).toBe("Tess");
    // Single use.
    expect(await checkInvitation(t.serviceRpc, code)).toBe(false);
    await expect(signUp("tester1b@example.com", { display_name: "Twin", alpha_invite: code })).rejects.toThrow(/alpha_invitation_invalid/);
    expect(await userExists("tester1b@example.com")).toBe(false);
  });

  it("refuses unknown, expired and revoked invitations", async () => {
    await expect(signUp("guess@example.com", { alpha_invite: generateInviteCode() })).rejects.toThrow(/alpha_invitation_invalid/);
    const expired = await invite();
    await t.arrange("update public.alpha_invitations set created_at = now() - interval '20 days', expires_at = now() - interval '1 day' where id = $1", [expired.id]);
    expect(await checkInvitation(t.serviceRpc, expired.code)).toBe(false);
    await expect(signUp("late@example.com", { alpha_invite: expired.code })).rejects.toThrow(/alpha_invitation_invalid/);
    const revoked = await invite();
    await t.serviceRpc("revoke_alpha_invitation", { p_id_prefix: revoked.id.slice(0, 8) });
    expect(await checkInvitation(t.serviceRpc, revoked.code)).toBe(false);
    await expect(signUp("revoked@example.com", { alpha_invite: revoked.code })).rejects.toThrow(/alpha_invitation_invalid/);
    for (const email of ["guess@example.com", "late@example.com", "revoked@example.com"]) expect(await userExists(email)).toBe(false);
  });

  it("lets only one of several simultaneous sign-ups use a code", async () => {
    const { code, id } = await invite();
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => signUp(`race${i}@example.com`, { display_name: `Race ${i}`, alpha_invite: code })),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect((await t.admin.query("select 1 from auth.users where email like 'race%@example.com'")).rows).toHaveLength(1);
    expect((await invitation(id)).redeemed_by).not.toBeNull();
  });

  it("never burns a code when account creation fails for another reason", async () => {
    await signUp("taken@example.com", { alpha_invite: (await invite()).code });
    const { code, id } = await invite();
    await expect(signUp("taken@example.com", { alpha_invite: code })).rejects.toThrow(/unique|duplicate/i);
    expect(await invitation(id)).toMatchObject({ redeemed_at: null, redeemed_by: null });
    expect(await checkInvitation(t.serviceRpc, code)).toBe(true);
  });

  it("has no exemptions: service-created accounts need an invitation too, and metadata never exempts", async () => {
    // Real Supabase Auth sets custom app_metadata only after the insert, so an exemption could never apply.
    await expect(signUp("qa@example.com", {}, { test_account: true })).rejects.toThrow(/alpha_invitation_required/);
    await expect(signUp("staff@example.com", {}, { alpha_exempt: true })).rejects.toThrow(/alpha_invitation_required/);
    await expect(signUp("sneaky@example.com", { test_account: true, alpha_exempt: true })).rejects.toThrow(/alpha_invitation_required/);
    await signUp("qa-invited@example.com", { alpha_invite: (await invite()).code }, { test_account: true });
    expect(await userExists("qa-invited@example.com")).toBe(true);
  });

  it("ignores malformed codes in the pre-check without asking the database", async () => {
    const neverCalled = async () => {
      throw new Error("database called");
    };
    for (const bad of [undefined, 42, "", "x".repeat(41), "CL-1234", "drop table"]) expect(await checkInvitation(neverCalled, bad)).toBe(false);
  });
});

describe("management", () => {
  it("lists statuses without hashes or emails", async () => {
    const open = await invite({ note: "open one" });
    const used = await invite({ note: "used one" });
    const user = await signUp("listed@example.com", { alpha_invite: used.code });
    await t.admin.query("update auth.users set email_confirmed_at = now() where id = $1", [user.id]);
    const pending = await invite({ note: "pending one" });
    await signUp("pending@example.com", { alpha_invite: pending.code });
    const list = (await t.serviceRpc("list_alpha_invitations", {})) as { invite_required: boolean; invitations: { id: string; status: string }[] };
    const status = (id: string) => list.invitations.find((i) => i.id === id)?.status;
    expect(status(open.id)).toBe("open");
    expect(status(used.id)).toBe("redeemed (confirmed)");
    expect(status(pending.id)).toBe("redeemed (awaiting email confirmation)");
    const json = JSON.stringify(list);
    expect(json).not.toMatch(/[0-9a-f]{64}/);
    expect(json).not.toMatch(/@example\.com/);
  });

  it("revokes only unused invitations, by unambiguous id prefix", async () => {
    const { code, id } = await invite();
    await signUp("redeemer@example.com", { alpha_invite: code });
    await expect(t.serviceRpc("revoke_alpha_invitation", { p_id_prefix: id.slice(0, 8) })).rejects.toThrow(/invitation_already_redeemed/);
    await expect(t.serviceRpc("revoke_alpha_invitation", { p_id_prefix: "abc" })).rejects.toThrow(/invalid_request/);
    await expect(t.serviceRpc("revoke_alpha_invitation", { p_id_prefix: "ffffffff-ffff" })).rejects.toThrow(/invitation_not_found/);
  });

  it("validates expiry and batch size", async () => {
    const hash = inviteCodeHash(generateInviteCode());
    await expect(t.serviceRpc("create_alpha_invitations", { p_code_hashes: [hash], p_expires_at: new Date(Date.now() - 1000).toISOString(), p_note: null })).rejects.toThrow(/invalid_request/);
    await expect(t.serviceRpc("create_alpha_invitations", { p_code_hashes: [hash], p_expires_at: new Date(Date.now() + 200 * 86_400_000).toISOString(), p_note: null })).rejects.toThrow(/invalid_request/);
    await expect(t.serviceRpc("create_alpha_invitations", { p_code_hashes: [], p_expires_at: new Date(Date.now() + 86_400_000).toISOString(), p_note: null })).rejects.toThrow(/invalid_request/);
  });

  it("keeps the invitation (redeemed) when its account is deleted", async () => {
    const { code, id } = await invite();
    const user = await signUp("leaver@example.com", { alpha_invite: code });
    await t.admin.query("delete from auth.users where id = $1", [user.id]);
    expect(await invitation(id)).toMatchObject({ redeemed_by: null });
    expect((await invitation(id)).redeemed_at).not.toBeNull();
    expect(await checkInvitation(t.serviceRpc, code)).toBe(false);
    const list = (await t.serviceRpc("list_alpha_invitations", {})) as { invitations: { id: string; status: string }[] };
    expect(list.invitations.find((i) => i.id === id)?.status).toBe("redeemed (account deleted)");
  });
});

describe("access control and integrity", () => {
  it("keeps invitations away from every API role", async () => {
    const tess = (await signUp("perm-tess@example.com", { alpha_invite: (await invite()).code })).id;
    for (const table of ["alpha_invitations", "alpha_access_settings"]) {
      await expect(t.asUser(tess, (db) => db.query(`select * from public.${table}`))).rejects.toThrow(denied);
      await expect(t.asAnon((db) => db.query(`select * from public.${table}`))).rejects.toThrow(denied);
    }
    await expect(t.asUser(tess, (db) => db.query("select public.check_alpha_invitation('CL-0000-0000-0000')"))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query("select public.set_alpha_invite_required(false)"))).rejects.toThrow(denied);
    await expect(t.asAnon((db) => db.query("select public.list_alpha_invitations()"))).rejects.toThrow(denied);
    await t.db.exec("set role service_role");
    try {
      await expect(t.db.query("select * from public.alpha_invitations")).rejects.toThrow(denied);
      await expect(t.db.query("update public.alpha_access_settings set invite_required = false")).rejects.toThrow(denied);
    } finally {
      await t.db.exec("reset role");
    }
  });

  it("guards invitations even against the owner", async () => {
    const { id } = await invite();
    await expect(t.admin.query("update public.alpha_invitations set code_hash = $2 where id = $1", [id, "0".repeat(64)])).rejects.toThrow(/immutable/);
    await expect(t.admin.query("update public.alpha_invitations set expires_at = now() + interval '1 year' where id = $1", [id])).rejects.toThrow(/immutable/);
    await expect(t.admin.query("delete from public.alpha_invitations where id = $1", [id])).rejects.toThrow(/append_only/);
    await t.serviceRpc("revoke_alpha_invitation", { p_id_prefix: id });
    await expect(t.admin.query("update public.alpha_invitations set revoked_at = null where id = $1", [id])).rejects.toThrow(/immutable/);
  });
});
