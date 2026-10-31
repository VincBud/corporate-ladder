"use client";

import { useSyncExternalStore } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createAuthStore, type AuthNotice, type AuthState, type AuthStore } from "./auth-store";

const NOTICES: readonly AuthNotice[] = ["confirmed", "recovery", "error", "unavailable"];
let store: AuthStore | null = null;

/** Reads (and removes) the ?auth= notice left by the email-link callback. */
function takeUrlNotice(): AuthNotice | null {
  const url = new URL(window.location.href);
  const notice = url.searchParams.get("auth") as AuthNotice | null;
  if (!notice) return null;
  url.searchParams.delete("auth");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return NOTICES.includes(notice) ? notice : null;
}

export function getAuthStore(): AuthStore {
  if (!store) {
    store = createAuthStore(getSupabaseBrowserClient()?.auth ?? null, {
      redirectBase: () => window.location.origin,
      initialNotice: takeUrlNotice(),
    });
  }
  return store;
}

const SERVER_STATE: AuthState = { status: isSupabaseConfigured() ? "loading" : "disabled", user: null, recovery: false, notice: null };
const subscribe = (listener: () => void) => getAuthStore().subscribe(listener);
const getSnapshot = () => getAuthStore().getState();
const getServerSnapshot = () => SERVER_STATE;

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
