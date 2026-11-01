import { NextResponse } from "next/server";
import { feedbackStatus } from "@/server/feedback/service";
import { apiError, rateLimit, requireUser, toErrorResponse } from "@/server/http";
import { getTrustedRpc } from "@/server/services";

/** Whether the signed-in player already answered this survey version (stops prompts on every device). */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("feedback-status", auth.user.id, 30);
  if (limited) return limited;
  const rpc = getTrustedRpc();
  if (!rpc) return apiError(503, "not_configured", "Feedback isn't available on this server right now.");
  try {
    return NextResponse.json(await feedbackStatus(rpc, auth.user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
