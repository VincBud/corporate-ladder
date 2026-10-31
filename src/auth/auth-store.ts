/**
 * Browser authentication state (email + password via Supabase Auth).
 * Framework-agnostic so it can be unit-tested with a fake auth client.
 *
 * Guests are always supported: with no Supabase project configured the
 * store reports "disabled" and the app runs on local progress only.
 */

export type AuthStatus = "disabled" | "loading" | "signedOut" | "signedIn";
/** One-off messages from email links (see app/auth/confirm). */
export type AuthNotice = "confirmed" | "recovery" | "error" | "unavailable";

export interface AuthUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** True after a password-recovery link: the player should choose a new password. */
  recovery: boolean;
  notice: AuthNotice | null;
}

export type AuthResult = { ok: true; message?: string } | { ok: false; message: string };

type RawUser = { id: string; email?: string | null; email_confirmed_at?: string | null };
type RawSession = { user: RawUser } | null;
type RawError = { message: string; code?: string } | null;

/** The subset of supabase.auth this store uses. */
export interface AuthClientLike {
  getSession(): Promise<{ data: { session: RawSession }; error: RawError }>;
  onAuthStateChange(callback: (event: string, session: RawSession) => void): { data: { subscription: { unsubscribe(): void } } };
  signInWithPassword(input: { email: string; password: string }): Promise<{ error: RawError }>;
  signUp(input: {
    email: string;
    password: string;
    options?: { emailRedirectTo?: string; data?: Record<string, string> };
  }): Promise<{ data: { session: RawSession }; error: RawError }>;
  signOut(options?: { scope?: "local" | "global" | "others" }): Promise<{ error: RawError }>;
  resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{ error: RawError }>;
  updateUser(input: { password: string }): Promise<{ error: RawError }>;
  resend(input: { type: "signup"; email: string; options?: { emailRedirectTo?: string } }): Promise<{ error: RawError }>;
}

export interface AuthStore {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string, displayName: string): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
  requestPasswordReset(email: string): Promise<AuthResult>;
  updatePassword(password: string): Promise<AuthResult>;
  resendConfirmation(email: string): Promise<AuthResult>;
  dismissNotice(): void;
}

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toUser = (raw: RawUser): AuthUser => ({ id: raw.id, email: raw.email ?? null, emailConfirmed: Boolean(raw.email_confirmed_at) });

function friendly(error: RawError, fallback: string): string {
  const message = error?.message ?? "";
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Please confirm your email address first. You can resend the link below.";
  if (/already registered|already exists/i.test(message)) return "An account with this email already exists. Try signing in.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Please wait a minute and try again.";
  if (/password/i.test(message) && /weak|short|characters/i.test(message)) return `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`;
  if (/fetch|network/i.test(message)) return "Couldn't reach the account service. Check your connection.";
  return fallback;
}

export function createAuthStore(
  client: AuthClientLike | null,
  options: { redirectBase?: () => string; initialNotice?: AuthNotice | null } = {},
): AuthStore {
  const redirect = (path: string) => `${options.redirectBase?.() ?? ""}${path}`;
  let state: AuthState = {
    status: client ? "loading" : "disabled",
    user: null,
    recovery: options.initialNotice === "recovery",
    notice: options.initialNotice ?? null,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<AuthState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const applySession = (session: RawSession) =>
    set(session ? { status: "signedIn", user: toUser(session.user) } : { status: "signedOut", user: null, recovery: false });

  let started = false;
  function start() {
    if (started || !client) return;
    started = true;
    client.onAuthStateChange((event, session) => {
      // Covers sign-in/out in this tab and in other tabs, token refresh and expiry.
      if (event === "PASSWORD_RECOVERY") set({ recovery: true });
      applySession(session);
    });
    client.getSession().then(
      ({ data }) => applySession(data.session),
      () => set({ status: "signedOut", user: null }),
    );
  }

  const unavailable: AuthResult = { ok: false, message: "Accounts aren't available on this server." };
  const invalidEmail: AuthResult = { ok: false, message: "Please enter a valid email address." };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      start();
      return () => listeners.delete(listener);
    },

    async signIn(email, password) {
      if (!client) return unavailable;
      if (!EMAIL_PATTERN.test(email.trim())) return invalidEmail;
      const { error } = await client.signInWithPassword({ email: email.trim(), password });
      return error ? { ok: false, message: friendly(error, "Sign-in failed. Please try again.") } : { ok: true };
    },

    async signUp(email, password, displayName) {
      if (!client) return unavailable;
      if (!EMAIL_PATTERN.test(email.trim())) return invalidEmail;
      if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` };
      const name = displayName.trim();
      if (name.length < 2 || name.length > 40) return { ok: false, message: "Display names need 2–40 characters." };
      const { data, error } = await client.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: redirect("/auth/confirm"), data: { display_name: name } },
      });
      if (error) return { ok: false, message: friendly(error, "Couldn't create the account. Please try again.") };
      return data.session
        ? { ok: true, message: "Welcome aboard. Your account is ready." }
        : { ok: true, message: "Check your inbox and confirm your email address to finish signing up." };
    },

    async signOut() {
      if (!client) return unavailable;
      const { error } = await client.signOut({ scope: "local" });
      // Even if the network call fails, the local session is cleared.
      applySession(null);
      return error ? { ok: true, message: "Signed out on this device." } : { ok: true };
    },

    async requestPasswordReset(email) {
      if (!client) return unavailable;
      if (!EMAIL_PATTERN.test(email.trim())) return invalidEmail;
      const { error } = await client.resetPasswordForEmail(email.trim(), { redirectTo: redirect("/auth/confirm?flow=recovery") });
      if (error && /rate limit|too many/i.test(error.message)) return { ok: false, message: friendly(error, "") };
      // Same answer whether or not the address has an account.
      return { ok: true, message: "If that address has an account, a reset link is on its way." };
    },

    async updatePassword(password) {
      if (!client) return unavailable;
      if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` };
      const { error } = await client.updateUser({ password });
      if (error) return { ok: false, message: friendly(error, "Couldn't update the password. Request a new reset link.") };
      set({ recovery: false });
      return { ok: true, message: "Password updated." };
    },

    async resendConfirmation(email) {
      if (!client) return unavailable;
      if (!EMAIL_PATTERN.test(email.trim())) return invalidEmail;
      const { error } = await client.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: redirect("/auth/confirm") } });
      return error ? { ok: false, message: friendly(error, "Couldn't resend the link.") } : { ok: true, message: "Confirmation link sent." };
    },

    dismissNotice() {
      if (state.notice) set({ notice: null });
    },
  };
}
