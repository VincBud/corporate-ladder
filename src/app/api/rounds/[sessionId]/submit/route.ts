import { NextResponse } from "next/server";
import { apiError, rateLimit, readJsonBody, requireUser, toErrorResponse } from "@/server/http";
import { assertSessionId } from "@/server/rounds/payload";
import { syncAchievementsSafely } from "@/server/achievements/service";
import { getCompanyService, getRoundService, getTrustedRpc } from "@/server/services";

/** Submits the final sheet. The server scores it; repeats return the stored result. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("submit", auth.user.id, 30);
  if (limited) return limited;
  const service = getRoundService();
  if (!service) return apiError(503, "not_configured", "Verified play isn't configured on this server.");
  try {
    const sessionId = assertSessionId((await params).sessionId);
    const body = await readJsonBody(request);
    const result = await service.submitRound(auth.user.id, sessionId, body);
    // The company snapshot on this instance now includes the new contribution.
    if (result.created || result.contribution.recorded) getCompanyService()?.invalidate();
    const achievements = await syncAchievementsSafely(getTrustedRpc(), auth.user.id);
    return NextResponse.json({ ...result, achievements: achievements?.created ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
