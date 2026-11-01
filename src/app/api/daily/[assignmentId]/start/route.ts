import { NextResponse } from "next/server";
import { apiError, rateLimit, requireUser, toErrorResponse } from "@/server/http";
import { getDailyService } from "@/server/services";

/**
 * Starts (or resumes) the signed-in player's ranked attempt at today's
 * challenge. Repeating the request returns the same round and deadline;
 * once the round is final, the attempt is used (409 daily_attempt_used).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("daily-start", auth.user.id, 30);
  if (limited) return limited;
  const service = getDailyService();
  if (!service) return apiError(503, "not_configured", "Verified play isn't configured on this server.");
  try {
    const { assignmentId } = await params;
    return NextResponse.json(await service.start(auth.user.id, assignmentId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
