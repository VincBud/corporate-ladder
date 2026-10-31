/**
 * Browser access to the live company. Read-only: the snapshot comes from
 * GET /api/company and is validated before use. A failed request is
 * reported as such; it is never replaced with demo data.
 */
import { parseCompanySnapshot, type CompanyDataSource } from "@/simulation/source";
import { ApiError, api } from "./api-client";

export const httpCompanySource: CompanyDataSource = {
  async loadSnapshot() {
    try {
      const snapshot = parseCompanySnapshot(await api.company());
      return snapshot ? { status: "ok", snapshot } : { status: "unavailable", message: "The server sent company data this app doesn't understand." };
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_configured") return { status: "notConfigured" };
      return { status: "unavailable", message: error instanceof Error ? error.message : "Couldn't load the company." };
    }
  },
};

const COMPANY_CHANGED = "corporate-ladder:company-changed";

/** Tells open windows that a verified contribution was just recorded. */
export function notifyCompanyChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COMPANY_CHANGED));
}

export function onCompanyChanged(listener: () => void): () => void {
  window.addEventListener(COMPANY_CHANGED, listener);
  return () => window.removeEventListener(COMPANY_CHANGED, listener);
}
