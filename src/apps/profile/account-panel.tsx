"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { looksLikeInviteCode } from "@/alpha/invite-format";
import { MIN_PASSWORD_LENGTH, type AuthResult } from "@/auth/auth-store";
import { getAuthStore, useAuth } from "@/auth/use-auth";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { departmentDisplayName } from "@/config/departments";
import { cn } from "@/lib/cn";
import type { CareerState } from "@/performance/career-store";
import { forgetSignedInCareers, getCareerStore, useActiveCareerScope } from "@/performance/use-career";
import { api } from "@/services/api-client";

type Feedback = { tone: "ok" | "error"; text: string } | null;

const inputClass =
  "w-full rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent/60 focus:outline-none";
const primaryButton =
  "rounded-lg bg-accent-strong px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent disabled:opacity-50";
const quietButton =
  "rounded-lg bg-white/6 px-3 py-1.5 text-[13px] font-medium text-fg ring-1 ring-line transition-colors ring-inset hover:bg-white/10 disabled:opacity-50";

function Message({ feedback }: { feedback: Feedback }) {
  return (
    <p role={feedback?.tone === "error" ? "alert" : "status"} className={cn("text-xs", feedback?.tone === "error" ? "text-rose-300" : "text-success")}>
      {feedback?.text ?? ""}
    </p>
  );
}

function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[12px] text-fg-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

/** Runs an auth action with pending + feedback state. */
function useAction() {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  async function run(action: () => Promise<AuthResult>) {
    setPending(true);
    setFeedback(null);
    const result = await action();
    setPending(false);
    setFeedback(result.ok ? (result.message ? { tone: "ok", text: result.message } : null) : { tone: "error", text: result.message });
    return result;
  }
  return { pending, feedback, run, setFeedback };
}

type Tab = "signIn" | "signUp" | "reset";

function SignedOut() {
  const [tab, setTab] = useState<Tab>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  // Closed alpha: whether new accounts need an invitation (asked once; the database enforces it either way).
  const [inviteRequired, setInviteRequired] = useState(false);
  const { pending, feedback, run, setFeedback } = useAction();
  const auth = getAuthStore();

  useEffect(() => {
    let cancelled = false;
    api.alphaAccess().then(
      (access) => {
        if (!cancelled) setInviteRequired(access.inviteRequired);
      },
      () => {
        // Unknown: the field stays hidden; a refused sign-up still explains the invitation.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function register(): Promise<AuthResult> {
    if (inviteRequired && !looksLikeInviteCode(inviteCode)) {
      return { ok: false, message: "Enter the invitation code from your invitation, e.g. CL-7K2M-9QXA-4T0B." };
    }
    if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` };
    if (password !== confirmPassword) return { ok: false, message: "The passwords don't match." };
    if (inviteRequired) {
      try {
        if (!(await api.checkInvitation(inviteCode)).valid) {
          return { ok: false, message: "This invitation code isn't valid or has already been used. Check it, or ask for a new one." };
        }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Couldn't check the invitation. Please try again." };
      }
    }
    return auth.signUp(email, password, displayName, inviteRequired ? inviteCode : undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (tab === "signIn") await run(() => auth.signIn(email, password));
    if (tab === "signUp") {
      const result = await run(register);
      if (result.ok) setAwaitingConfirmation(true);
    }
    if (tab === "reset") await run(() => auth.requestPasswordReset(email));
  }

  const tabs: [Tab, string][] = [
    ["signIn", "Sign in"],
    ["signUp", "Create account"],
    ["reset", "Forgot password"],
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-fg-muted">
        You&apos;re playing as a guest: progress is saved in this browser only and isn&apos;t verified. An account saves
        verified results on the server, across devices.
      </p>
      <div role="group" aria-label="Account action" className="flex flex-wrap gap-1 rounded-lg bg-white/5 p-0.5 ring-1 ring-line ring-inset">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setFeedback(null);
            }}
            className="rounded-md px-3 py-1 text-xs font-medium text-fg-muted aria-pressed:bg-surface-hover aria-pressed:text-fg"
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="grid max-w-sm gap-3" noValidate>
        {tab === "signUp" && inviteRequired && (
          <Field label="Invitation code" hint="Closed alpha: from your invitation. Each code creates one account.">
            {(id) => (
              <input
                id={id}
                className={cn(inputClass, "font-mono tracking-wider uppercase")}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="CL-XXXX-XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={24}
                required
              />
            )}
          </Field>
        )}
        {tab === "signUp" && (
          <Field label="Display name" hint="2–40 characters. You can change it later.">
            {(id) => <input id={id} className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" maxLength={40} required />}
          </Field>
        )}
        <Field label="Work email">
          {(id) => <input id={id} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}
        </Field>
        {tab !== "reset" && (
          <Field label="Password" hint={tab === "signUp" ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}>
            {(id) => (
              <input
                id={id}
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === "signUp" ? "new-password" : "current-password"}
                required
              />
            )}
          </Field>
        )}
        {tab === "signUp" && (
          <Field label="Confirm password">
            {(id) => (
              <input
                id={id}
                type="password"
                className={inputClass}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            )}
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? "Please wait…" : tab === "signIn" ? "Sign in" : tab === "signUp" ? "Create account" : "Send reset link"}
          </button>
          {(awaitingConfirmation || /confirm your email/i.test(feedback?.text ?? "")) && (
            <button type="button" disabled={pending} onClick={() => void run(() => auth.resendConfirmation(email))} className={quietButton}>
              Resend confirmation
            </button>
          )}
        </div>
        <Message feedback={feedback} />
      </form>
    </div>
  );
}

function SetNewPassword() {
  const [password, setPassword] = useState("");
  const { pending, feedback, run } = useAction();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => getAuthStore().updatePassword(password));
      }}
      className="grid max-w-sm gap-3"
    >
      <p className="text-xs text-fg-muted">Your reset link worked. Choose a new password to finish.</p>
      <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        {(id) => <input id={id} type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
      </Field>
      <button type="submit" disabled={pending} className={cn(primaryButton, "justify-self-start")}>
        {pending ? "Saving…" : "Set new password"}
      </button>
      <Message feedback={feedback} />
    </form>
  );
}

function SignedIn({ career, onOpenDepartments }: { career: CareerState; onOpenDepartments: () => void }) {
  const auth = useAuth();
  const scope = useActiveCareerScope();
  const profile = career.profile;
  const [displayName, setDisplayName] = useState<string | null>(null);
  const { pending, feedback, run } = useAction();

  const saveProfile = (patch: { displayName: string }) =>
    run(async () => {
      try {
        await api.updateProfile(patch);
        if (scope) await getCareerStore(scope).load();
        setDisplayName(null);
        return { ok: true, message: "Profile updated." };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Couldn't update the profile." };
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px]">{auth.user?.email}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone="success">Cloud account</Badge>
            {auth.user?.emailConfirmed ? <Badge>Email confirmed</Badge> : <Badge tone="warning">Email not confirmed</Badge>}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              const result = await getAuthStore().signOut();
              forgetSignedInCareers();
              return result;
            })
          }
          disabled={pending}
          className={quietButton}
        >
          Sign out
        </button>
      </div>

      {career.loadStatus === "unauthorized" && (
        <p role="alert" className="text-xs text-warning">Your session expired. Sign out and sign in again to keep saving progress.</p>
      )}
      {career.loadStatus === "offline" && (
        <p role="status" className="text-xs text-warning">Can&apos;t reach the server right now. Showing your last known progress.</p>
      )}

      {profile && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (displayName !== null) void saveProfile({ displayName });
          }}
          className="grid max-w-md gap-3 @lg:grid-cols-2"
        >
          <Field label="Display name">
            {(id) => (
              <input id={id} className={inputClass} value={displayName ?? profile.displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
            )}
          </Field>
          <div className="space-y-1">
            <p className="text-[12px] text-fg-muted">Department</p>
            <p className="text-[13px]">
              {departmentDisplayName(profile.departmentId) ?? "Not chosen yet"}{" "}
              <button type="button" onClick={onOpenDepartments} className="ml-1 text-xs text-accent hover:underline">
                {profile.departmentId ? "Transfer" : "Choose"}
              </button>
            </p>
          </div>
          <div className="flex items-center gap-3 @lg:col-span-2">
            <button type="submit" disabled={pending || displayName === null} className={primaryButton}>
              Save name
            </button>
            <Message feedback={feedback} />
          </div>
        </form>
      )}
    </div>
  );
}

/** Account state for the Employee Profile: guest sign-in, account details, or recovery. */
export function AccountPanel({ career, onOpenDepartments }: { career: CareerState; onOpenDepartments: () => void }) {
  const auth = useAuth();
  return (
    <Panel title="Account" description={auth.status === "signedIn" ? "Verified progress, saved to your account" : "Guest or cloud progress"}>
      {auth.status === "disabled" ? (
        <p className="text-xs leading-relaxed text-fg-muted">
          Cloud accounts aren&apos;t configured on this server. Your progress is saved in this browser only.
        </p>
      ) : auth.status === "loading" ? (
        <p className="text-xs text-fg-subtle">Checking your badge…</p>
      ) : auth.status === "signedIn" && auth.recovery ? (
        <SetNewPassword />
      ) : auth.status === "signedIn" ? (
        <SignedIn career={career} onOpenDepartments={onOpenDepartments} />
      ) : (
        <SignedOut />
      )}
    </Panel>
  );
}
