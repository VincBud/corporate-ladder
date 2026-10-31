/**
 * Which career a browser shows. Each scope has its own store, so a guest's
 * local history and each signed-in account never mix.
 */
import type { AuthState } from "@/auth/auth-store";
import type { CareerRepository } from "@/services/career-repository";
import { createCareerStore, type CareerStore } from "./career-store";

export const GUEST_SCOPE = "guest";
export type CareerScope = typeof GUEST_SCOPE | `user:${string}`;

/** Null while authentication is still being restored: show nothing rather than the wrong career. */
export function careerScopeFor(auth: Pick<AuthState, "status" | "user">): CareerScope | null {
  if (auth.status === "loading") return null;
  if (auth.status === "signedIn" && auth.user) return `user:${auth.user.id}`;
  return GUEST_SCOPE;
}

export interface CareerRegistryOptions {
  localRepository: () => CareerRepository;
  cloudRepository: () => CareerRepository;
  baselineXp: number;
  /** Called when a store is created, e.g. to wire refresh-on-focus. Returns a cleanup. */
  onCreate?: (scope: CareerScope, store: CareerStore) => (() => void) | void;
}

export function createCareerRegistry(options: CareerRegistryOptions) {
  const stores = new Map<CareerScope, { store: CareerStore; cleanup?: () => void }>();

  return {
    get(scope: CareerScope): CareerStore {
      const existing = stores.get(scope);
      if (existing) return existing.store;
      if (scope !== GUEST_SCOPE) {
        // Switching accounts: drop every other signed-in player's data from memory.
        for (const [key, entry] of stores) {
          if (key !== GUEST_SCOPE) {
            entry.cleanup?.();
            stores.delete(key);
          }
        }
      }
      const store =
        scope === GUEST_SCOPE
          ? createCareerStore(options.localRepository(), { baselineXp: options.baselineXp, source: "local" })
          : createCareerStore(options.cloudRepository(), { source: "cloud" });
      stores.set(scope, { store, cleanup: options.onCreate?.(scope, store) ?? undefined });
      return store;
    },
    /** Signing out: forget signed-in data, keep the guest store. */
    dropSignedIn() {
      for (const [key, entry] of stores) {
        if (key !== GUEST_SCOPE) {
          entry.cleanup?.();
          stores.delete(key);
        }
      }
    },
    scopes: () => [...stores.keys()],
  };
}
