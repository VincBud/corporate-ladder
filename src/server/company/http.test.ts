import { describe, expect, it, vi } from "vitest";
import { buildLiveSnapshot } from "@/simulation/live";
import { handleCompanyRequest } from "./http";
import { CompanyUnavailableError, type CompanyService } from "./service";

const { snapshot } = buildLiveSnapshot({
  periodId: "2026-Q4",
  generatedAt: "2026-11-05T12:00:00.000Z",
  registeredEmployees: 0,
  membership: [],
  events: [],
  allocations: [
    { game_id: "reconciliation-rush", formula_version: 1, metric_id: "ledger-integrity", department_id: "controlling", weight_bp: 7000 },
    { game_id: "reconciliation-rush", formula_version: 1, metric_id: "close-quality", department_id: "finance", weight_bp: 3000 },
  ],
  lastContributionAt: null,
});

const service = (getSnapshot: CompanyService["getSnapshot"]): CompanyService => ({ getSnapshot, invalidate: () => {} });
const get = (query = "") => new Request(`http://localhost/api/company${query}`);

describe("GET /api/company", () => {
  it("returns the snapshot without caching in the browser or CDN", async () => {
    const response = await handleCompanyRequest(get(), service(async () => snapshot));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(snapshot);
  });

  it("takes no parameters", async () => {
    const response = await handleCompanyRequest(get("?period=2025-Q1"), service(async () => snapshot));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("returns 503 when the backend isn't configured", async () => {
    const response = await handleCompanyRequest(get(), null);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("not_configured");
  });

  it("returns a safe 503 when data is unavailable, without internal details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleCompanyRequest(
      get(),
      service(async () => {
        throw new CompanyUnavailableError("database", "password authentication failed for user postgres at db.internal:5432");
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("15");
    const text = await response.text();
    expect(text).toContain("company_unavailable");
    expect(text).not.toMatch(/password|postgres|5432/);
    log.mockRestore();
  });

  it("returns 500 for unexpected errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleCompanyRequest(
      get(),
      service(async () => {
        throw new TypeError("boom");
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
    log.mockRestore();
  });
});
