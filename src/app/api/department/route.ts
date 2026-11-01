import { NextResponse } from "next/server";
import { syncAchievementsSafely } from "@/server/achievements/service";
import { selectDepartment } from "@/server/departments/service";
import { apiError, rateLimit, readJsonBody, requireUser, toErrorResponse } from "@/server/http";
import { getCompanyService, getTrustedRpc } from "@/server/services";

/** Joins a department or transfers to another one (30-day cooldown, enforced by the database). */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const limited = rateLimit("department", auth.user.id, 10);
  if (limited) return limited;
  const rpc = getTrustedRpc();
  if (!rpc) return apiError(503, "not_configured", "Departments aren't configured on this server.");
  try {
    const body = await readJsonBody(request, 1_024);
    const result = await selectDepartment(rpc, auth.user.id, body);
    // Workforce counts in the company snapshot change with membership.
    if (result.status !== "duplicate") getCompanyService()?.invalidate();
    const achievements = await syncAchievementsSafely(rpc, auth.user.id);
    return NextResponse.json({ ...result, achievements: achievements?.created ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
