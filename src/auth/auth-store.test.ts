import { describe, expect, it } from "vitest";
import { createAuthStore, type AuthClientLike } from "./auth-store";

type Session = { user: { id: string; email: string; email_confirmed_at: string | null } } | null;

function fakeClient(initial: Session = null) {
  let session = initial;
  let listener: ((event: string, s: Session) => void) | null = null;
  const calls: string[] = [];
  const client: AuthClientLike & { emit(event: string, s: Session): void; failNextSignOut: boolean } = {
    failNextSignOut: false,
    async getSession() {
      return { data: { session }, error: null };
    },
    onAuthStateChange(cb) {
      listener = cb;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signInWithPassword({ email, password }) {
      calls.push(`signIn:${email}`);
      if (password !== "correct-horse") return { error: { message: "Invalid login credentials" } };
      session = { user: { id: `id-${email}`, email, email_confirmed_at: "2026-10-30" } };
      listener?.("SIGNED_IN", session);
      return { error: null };
    },
    async signUp({ email, options }) {
      calls.push(`signUp:${email}:${options?.data?.display_name}:${options?.emailRedirectTo}`);
      return { data: { session: null }, error: null };
    },
    async signOut() {
      calls.push("signOut");
      session = null;
      listener?.("SIGNED_OUT", null);
      return { error: client.failNextSignOut ? { message: "fetch failed" } : null };
    },
    async resetPasswordForEmail(email, options) {
      calls.push(`reset:${email}:${options?.redirectTo}`);
      return { error: null };
    },
    async updateUser() {
      return { error: null };
    },
    async resend() {
      return { error: null };
    },
    emit(event, s) {
      session = s;
      listener?.(event, s);
    },
  };
  return { client, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("auth store", () => {
  it("is disabled (guest-only) when Supabase isn't configured", async () => {
    const store = createAuthStore(null);
    expect(store.getState().status).toBe("disabled");
    expect(await store.signIn("a@b.co", "x")).toMatchObject({ ok: false });
  });

  it("restores an existing session after a refresh", async () => {
    const { client } = fakeClient({ user: { id: "u1", email: "a@b.co", email_confirmed_at: "x" } });
    const store = createAuthStore(client);
    expect(store.getState().status).toBe("loading");
    store.subscribe(() => {});
    await flush();
    expect(store.getState()).toMatchObject({ status: "signedIn", user: { id: "u1", emailConfirmed: true } });
  });

  it("signs in, reports bad credentials kindly, and signs out", async () => {
    const { client } = fakeClient();
    const store = createAuthStore(client);
    store.subscribe(() => {});
    await flush();
    expect(store.getState().status).toBe("signedOut");
    expect(await store.signIn("a@b.co", "wrong")).toEqual({ ok: false, message: "Email or password is incorrect." });
    expect(await store.signIn("a@b.co", "correct-horse")).toEqual({ ok: true });
    expect(store.getState().user?.id).toBe("id-a@b.co");
    await store.signOut();
    expect(store.getState()).toMatchObject({ status: "signedOut", user: null });
  });

  it("follows account switches and expiry from other tabs", async () => {
    const { client } = fakeClient({ user: { id: "u1", email: "a@b.co", email_confirmed_at: "x" } });
    const store = createAuthStore(client);
    store.subscribe(() => {});
    await flush();
    client.emit("SIGNED_IN", { user: { id: "u2", email: "c@d.co", email_confirmed_at: "x" } });
    expect(store.getState().user?.id).toBe("u2");
    client.emit("SIGNED_OUT", null); // e.g. refresh token expired
    expect(store.getState().status).toBe("signedOut");
  });

  it("clears the local session even when the sign-out request fails", async () => {
    const { client } = fakeClient({ user: { id: "u1", email: "a@b.co", email_confirmed_at: "x" } });
    client.failNextSignOut = true;
    const store = createAuthStore(client);
    store.subscribe(() => {});
    await flush();
    expect((await store.signOut()).ok).toBe(true);
    expect(store.getState().status).toBe("signedOut");
  });

  it("validates sign-up input and asks for email confirmation", async () => {
    const { client, calls } = fakeClient();
    const store = createAuthStore(client, { redirectBase: () => "https://corp.example" });
    expect((await store.signUp("not-an-email", "longenough", "Al")).ok).toBe(false);
    expect((await store.signUp("a@b.co", "short", "Al")).ok).toBe(false);
    expect((await store.signUp("a@b.co", "longenough", "A")).ok).toBe(false);
    const result = await store.signUp("a@b.co", "longenough", "Alice");
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("confirm your email") });
    expect(calls.at(-1)).toBe("signUp:a@b.co:Alice:https://corp.example/auth/confirm");
  });

  it("does not reveal whether an email has an account on password reset", async () => {
    const { client, calls } = fakeClient();
    const store = createAuthStore(client, { redirectBase: () => "https://corp.example" });
    const result = await store.requestPasswordReset("nobody@example.com");
    expect(result).toEqual({ ok: true, message: "If that address has an account, a reset link is on its way." });
    expect(calls.at(-1)).toBe("reset:nobody@example.com:https://corp.example/auth/confirm?flow=recovery");
  });

  it("enters and leaves password recovery", async () => {
    const { client } = fakeClient();
    const store = createAuthStore(client, { initialNotice: "recovery" });
    expect(store.getState()).toMatchObject({ recovery: true, notice: "recovery" });
    store.dismissNotice();
    expect(store.getState().notice).toBeNull();
    expect((await store.updatePassword("short")).ok).toBe(false);
    expect(await store.updatePassword("a-new-long-password")).toEqual({ ok: true, message: "Password updated." });
    expect(store.getState().recovery).toBe(false);
  });
});
