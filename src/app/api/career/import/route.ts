import { NextResponse } from "next/server";
import { importLegacy } from "@/server/career/service";
import { apiError, rateLimit, readJsonBody, requireUser, toErrorResponse } from "@/server/http";
import { getTrustedRpc } from "@/server/services";

/** Imports this browser's guest history as unverified legacy practice (no XP). */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("import", auth.user.id, 10);
  if (limited) return limited;
  const rpc = getTrustedRpc();
  if (!rpc) return apiError(503, "not_configured", "Cloud accounts aren't configured on this server.");
  try {
    const body = await readJsonBody(request, 262_144);
    return NextResponse.json(await importLegacy(rpc, auth.user.id, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
