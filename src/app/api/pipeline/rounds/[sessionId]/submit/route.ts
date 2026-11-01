import { NextResponse } from "next/server";
import { apiError, rateLimit, readJsonBody, requireUser, toErrorResponse } from "@/server/http";
import { assertSessionId } from "@/server/rounds/payload";
import { getCompanyService, getPipelineService } from "@/server/services";

/** Submits the round's decisions. The server scores them; repeats return the stored result. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("submit", auth.user.id, 30);
  if (limited) return limited;
  const service = getPipelineService();
  if (!service) return apiError(503, "not_configured", "Verified play isn't configured on this server.");
  try {
    const sessionId = assertSessionId((await params).sessionId);
    const body = await readJsonBody(request);
    const result = await service.submitRound(auth.user.id, sessionId, body);
    if (result.created || result.contribution.recorded) getCompanyService()?.invalidate();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
