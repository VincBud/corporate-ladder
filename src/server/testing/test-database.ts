/**
 * Test-only: a real Postgres (PGlite, WASM) with a minimal stand-in for the
 * Supabase environment, running the project's actual migrations.
 *
 * Faithful: Postgres semantics for constraints, transactions, grants, RLS,
 * SECURITY DEFINER functions and the anon / authenticated / service_role
 * roles, including Supabase's broad default privileges (which the migration
 * must revoke). Not covered: Supabase Auth/GoTrue, PostgREST, real network
 * concurrency (PGlite runs one connection), and the hosted platform itself.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { RpcCall } from "@/server/rounds/round-store";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    raw_app_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase-style defaults: everything granted, to be narrowed by migrations.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export interface TestDatabase {
  db: PGlite;
  /** Creates an auth user (and, via trigger, a profile). Returns the user id. */
  createUser(email: string, displayName?: string, options?: { testAccount?: boolean }): Promise<string>;
  /** Runs queries as a signed-in player (role authenticated, auth.uid() = userId). */
  asUser<T>(userId: string, run: (db: PGlite) => Promise<T>): Promise<T>;
  /** Runs queries as an anonymous visitor. */
  asAnon<T>(run: (db: PGlite) => Promise<T>): Promise<T>;
  /** RPC as the trusted server (service_role), shaped like supabase.rpc. */
  serviceRpc: RpcCall;
  /** Superuser access for arranging test state (e.g. moving time). */
  admin: PGlite;
  /**
   * Arranges states the integrity triggers forbid (e.g. a replayed seed),
   * with triggers disabled for the duration. Test setup only.
   */
  arrange(sql: string, params?: unknown[]): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  async function withRole<T>(role: string, sub: string, run: (db: PGlite) => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
    await db.exec(`set role ${role}`);
    try {
      return await run(db);
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  }

  return {
    db,
    admin: db,
    async createUser(email, displayName, options) {
      const result = await db.query<{ id: string }>(
        "insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id",
        [email, JSON.stringify(displayName ? { display_name: displayName } : {}), JSON.stringify(options?.testAccount ? { test_account: true } : {})],
      );
      return result.rows[0].id;
    },
    async arrange(sql, params = []) {
      await db.exec("set session_replication_role = replica");
      try {
        await db.query(sql, params);
      } finally {
        await db.exec("set session_replication_role = default");
      }
    },
    asUser: (userId, run) => withRole("authenticated", userId, run),
    asAnon: (run) => withRole("anon", "", run),
    serviceRpc: async (fn, args) =>
      withRole("service_role", "", async (conn) => {
        const keys = Object.keys(args);
        const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as result`;
        const params = keys.map((k) => {
          const value = args[k];
          return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
        });
        const result = await conn.query<{ result: unknown }>(call, params);
        return result.rows[0]?.result ?? null;
      }),
  };
}
