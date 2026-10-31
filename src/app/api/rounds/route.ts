import { NextResponse } from "next/server";
import { apiError, rateLimit, requireUser, toErrorResponse } from "@/server/http";
import { getRoundService } from "@/server/services";

/** Starts a verified Reconciliation Rush round for the signed-in player. */
export async function POST() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("start-round", auth.user.id, 12);
  if (limited) return limited;
  const service = getRoundService();
  if (!service) return apiError(503, "not_configured", "Verified play isn't configured on this server.");
  try {
    return NextResponse.json(await service.startRound(auth.user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
