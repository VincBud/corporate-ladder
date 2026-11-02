/**
 * Cross-site request check for state-changing API calls (CSRF defense in
 * depth on top of SameSite=Lax session cookies). Browsers send Origin (and
 * Sec-Fetch-Site) on cross-origin POSTs; a request is rejected when either
 * says it came from another site. Requests without these headers come from
 * non-browser clients, which can't ride on a visitor's cookies.
 */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface RequestOrigin {
  method: string;
  /** The Origin header, if any. */
  origin: string | null;
  /** The Host header this server was reached at. */
  host: string | null;
  /** The Sec-Fetch-Site header, if any. */
  secFetchSite: string | null;
}

export function isCrossSiteWrite({ method, origin, host, secFetchSite }: RequestOrigin): boolean {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return false;
  if (secFetchSite === "cross-site" || secFetchSite === "same-site") return true;
  if (!origin) return false;
  if (origin === "null") return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
