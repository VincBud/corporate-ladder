import "server-only";
import { NextResponse } from "next/server";
import { apiError } from "../http";
import { CompanyUnavailableError, type CompanyService } from "./service";

/**
 * GET /api/company. Public and read-only: the aggregate company snapshot
 * for the current quarter. Takes no parameters.
 *
 * Cache-Control is no-store so a player sees their verified round right
 * after submitting; the server's own short cache protects the database.
 */
export async function handleCompanyRequest(request: Request, service: CompanyService | null): Promise<Response> {
  if (new URL(request.url).searchParams.size > 0) {
    return apiError(400, "invalid_request", "This endpoint takes no parameters.");
  }
  if (!service) return apiError(503, "not_configured", "The live company isn't configured on this server.");
  try {
    return NextResponse.json(await service.getSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CompanyUnavailableError) {
      console.error(`[api/company] unavailable (${error.reason}):`, error.message);
      const response = apiError(503, "company_unavailable", "Live company data is temporarily unavailable.");
      response.headers.set("Retry-After", "15");
      return response;
    }
    console.error("[api/company] unexpected error", error);
    return apiError(500, "server_error", "Something went wrong on our side.");
  }
}
