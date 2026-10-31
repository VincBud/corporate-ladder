/**
 * Browser client for the app's own API (same origin, session cookies).
 * Never sends scores, times or XP: only actions and cell contents.
 */
import type { PlayerEntries } from "@/games/spreadsheet-wars/reconciliation-rush/validate";
import type { CareerResponse, CloudProfile, ImportResponse } from "@/types/cloud-career";
import type { SelectDepartmentResponse } from "@/types/department-career";
import type { GameResultRecord } from "@/types/progression";
import type { ApiErrorBody, HintResponse, StartRoundResponse, SubmitRoundResponse } from "@/types/verified-play";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError(0, "network", "Couldn't reach the server. Check your connection.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, body?.error.code ?? "http_error", body?.error.message ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  startRound: () => post<StartRoundResponse>("/api/rounds", {}),
  requestHint: (sessionId: string, entries: PlayerEntries) => post<HintResponse>(`/api/rounds/${sessionId}/hint`, { entries }),
  submitRound: (sessionId: string, entries: PlayerEntries) => post<SubmitRoundResponse>(`/api/rounds/${sessionId}/submit`, { entries }),
  career: () => request<CareerResponse>("/api/career"),
  /** Public company snapshot; validate with parseCompanySnapshot (see company-source.ts). */
  company: () => request<unknown>("/api/company"),
  importLegacy: (records: readonly GameResultRecord[]) => post<ImportResponse>("/api/career/import", { records }),
  /** Joins or transfers; requestId makes retries safe. */
  selectDepartment: (departmentId: string, requestId: string) => post<SelectDepartmentResponse>("/api/department", { departmentId, requestId }),
  updateProfile: (patch: { displayName?: string }) =>
    request<CloudProfile>("/api/profile", { method: "PATCH", body: JSON.stringify(patch) }),
};
