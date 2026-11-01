import { NextResponse } from "next/server";
import { apiError, rateLimit, requireUser, toErrorResponse } from "@/server/http";
import { startAfterDailySettlement } from "@/server/daily/service";
import { getDailyService, getPipelineService } from "@/server/services";

/** Starts a verified Pipeline Panic round for the signed-in player. */
export async function POST() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("start-round", auth.user.id, 12);
  if (limited) return limited;
  const service = getPipelineService();
  if (!service) return apiError(503, "not_configured", "Verified play isn't configured on this server.");
  try {
    // An expired ranked daily round is finalized first; a running one blocks practice (409).
    const started = await startAfterDailySettlement(getDailyService(), auth.user.id, () => service.startRound(auth.user.id));
    return NextResponse.json(started, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
