"use client";

import { CloseIcon } from "@/components/icons";
import type { AuthNotice } from "@/auth/auth-store";

const COPY: Record<AuthNotice, { title: string; body: string; action?: string }> = {
  confirmed: { title: "Email confirmed", body: "Welcome aboard. Your progress is now saved to your account." },
  recovery: { title: "Choose a new password", body: "Your reset link worked. Set a new password in Employee Profile.", action: "Open Employee Profile" },
  error: { title: "That link didn't work", body: "It may have expired or already been used. Request a new one from Employee Profile.", action: "Open Employee Profile" },
  unavailable: { title: "Accounts unavailable", body: "Cloud accounts aren't configured on this server. Guest play still works." },
  passwordUpdated: { title: "Password updated", body: "You're signed in. Use the new password the next time you sign in." },
};

/** Result of following a link from a sign-up or password-reset email. */
export function AuthNoticeToast({ notice, onOpenProfile, onDismiss }: { notice: AuthNotice; onOpenProfile: () => void; onDismiss: () => void }) {
  const copy = COPY[notice];
  return (
    <div
      role="status"
      className="absolute top-4 left-1/2 z-[951] flex w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 animate-pop-in items-start gap-3 rounded-xl border border-line-strong bg-desk-900/95 p-3.5 shadow-popover"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{copy.title}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{copy.body}</p>
        {copy.action && (
          <button
            type="button"
            onClick={() => {
              onOpenProfile();
              onDismiss();
            }}
            className="mt-2 rounded-md bg-accent-strong px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent"
          >
            {copy.action}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
