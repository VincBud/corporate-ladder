import { NextResponse } from "next/server";
import { apiError, rateLimit, readJsonBody, requireUser, toErrorResponse } from "@/server/http";
import { assertSessionId } from "@/server/rounds/payload";
import { getRoundService } from "@/server/services";

/** Request Assistance for a verified round: computed on the server, once per round. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("hint", auth.user.id, 20);
  if (limited) return limited;
  const service = getRoundService();
  if (!service) return apiError(503, "not_configured", "Verified play isn't configured on this server.");
  try {
    const sessionId = assertSessionId((await params).sessionId);
    const body = await readJsonBody(request);
    return NextResponse.json(await service.requestHint(auth.user.id, sessionId, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
