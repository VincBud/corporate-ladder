/** Guest-history import against the real SQL function (PGlite). */
import { beforeAll, describe, expect, it } from "vitest";
import { resultInput } from "@/performance/test-fixtures";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { importLegacy } from "./service";

let t: TestDatabase;
let alice: string;
let bob: string;
const local = (id: string, overrides = {}) => ({ ...resultInput(), id, xpAwarded: 50, ...overrides });

beforeAll(async () => {
  t = await createTestDatabase();
  alice = await t.createUser("alice@example.com");
  bob = await t.createUser("bob@example.com");
}, 60_000);

describe("legacy practice import", () => {
  it("stores validated guest rounds without granting any XP", async () => {
    const result = await importLegacy(t.serviceRpc, alice, { records: [local("g1"), local("g2", { seed: "RR-2" })] });
    expect(result).toEqual({ imported: 2, alreadyImported: 0, invalid: 0 });
    const xp = await t.asUser(alice, (db) => db.query<{ xp: number }>("select public.get_my_career_xp() as xp"));
    expect(xp.rows[0].xp).toBe(0);
    const rows = await t.asUser(alice, (db) => db.query("select local_id from public.legacy_practice_results order by local_id"));
    expect(rows.rows).toEqual([{ local_id: "g1" }, { local_id: "g2" }]);
  });

  it("is idempotent: importing again adds nothing", async () => {
    const again = await importLegacy(t.serviceRpc, alice, { records: [local("g1"), local("g2", { seed: "RR-2" }), local("g3")] });
    expect(again).toEqual({ imported: 1, alreadyImported: 2, invalid: 0 });
  });

  it("drops invalid records and refuses oversized imports", async () => {
    const result = await importLegacy(t.serviceRpc, alice, { records: [local("bad", { score: -1 }), { id: "x" }, "garbage", local("g4")] });
    expect(result).toEqual({ imported: 1, alreadyImported: 0, invalid: 3 });
    await expect(importLegacy(t.serviceRpc, alice, { records: Array.from({ length: 201 }, (_, i) => local(`many-${i}`)) })).rejects.toThrow();
    await expect(importLegacy(t.serviceRpc, alice, { records: "nope" })).rejects.toThrow();
  });

  it("keeps each player's legacy history private", async () => {
    await importLegacy(t.serviceRpc, bob, { records: [local("g1")] }); // same local id, different player
    const bobRows = await t.asUser(bob, (db) => db.query("select user_id from public.legacy_practice_results"));
    expect(bobRows.rows).toEqual([{ user_id: bob }]);
  });
});
