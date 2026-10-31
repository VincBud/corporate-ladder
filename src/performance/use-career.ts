"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/auth/use-auth";
import { api } from "@/services/api-client";
import { CAREER_STORAGE_KEY, createLocalStorageCareerRepository } from "@/services/career-repository";
import { createCloudCareerRepository } from "@/services/cloud-career-repository";
import { getCurrentEmployee } from "@/services/employee-service";
import { GUEST_SCOPE, careerScopeFor, createCareerRegistry, type CareerScope } from "./career-scope";
import { INITIAL_CAREER_STATE, type CareerState, type CareerStore, type SessionOutcome } from "./career-store";

let registry: ReturnType<typeof createCareerRegistry> | null = null;

function getRegistry() {
  if (!registry) {
    registry = createCareerRegistry({
      localRepository: () => createLocalStorageCareerRepository(),
      cloudRepository: () => createCloudCareerRepository(api.career),
      baselineXp: getCurrentEmployee().xp,
      onCreate(scope, store) {
        if (scope === GUEST_SCOPE) {
          // Another tab finishing a guest round updates this one.
          const onStorage = (event: StorageEvent) => {
            if (event.key === CAREER_STORAGE_KEY) void store.load();
          };
          window.addEventListener("storage", onStorage);
          return () => window.removeEventListener("storage", onStorage);
        }
        // Cloud data can change in other tabs or devices: refresh when the player returns.
        const onFocus = () => void store.load();
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
      },
    });
  }
  return registry;
}

/** The career store for a scope. Guest results are recorded with getCareerStore("guest"). */
export function getCareerStore(scope: CareerScope = GUEST_SCOPE): CareerStore {
  return getRegistry().get(scope);
}

export function forgetSignedInCareers() {
  getRegistry().dropSignedIn();
}

const LOADING_STATE: CareerState = INITIAL_CAREER_STATE;
const noopSubscribe = () => () => {};

/** Career state for a specific scope (null = still deciding: shows a loading state). */
export function useCareerScope(scope: CareerScope | null): CareerState {
  const subscribe = useCallback(
    (listener: () => void) => (scope ? getCareerStore(scope).subscribe(listener) : noopSubscribe()),
    [scope],
  );
  const getSnapshot = useCallback(() => (scope ? getCareerStore(scope).getState() : LOADING_STATE), [scope]);
  return useSyncExternalStore(subscribe, getSnapshot, () => LOADING_STATE);
}

/** The career for whoever is using this browser right now (guest or signed-in account). */
export function useCareer(): CareerState {
  return useCareerScope(careerScopeFor(useAuth()));
}

export function useCareerSession(sessionId: string): SessionOutcome | undefined {
  return useCareer().sessions.get(sessionId);
}

/** Exposed for UI that needs the active scope (e.g. to apply verified results). */
export function useActiveCareerScope(): CareerScope | null {
  return careerScopeFor(useAuth());
}
