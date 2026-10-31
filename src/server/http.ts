import "server-only";
import type { User } from "@supabase/supabase-js";
import { NextResponse, connection } from "next/server";
import { createSupabaseServerClient, getVerifiedUser } from "@/lib/supabase/server";
import type { ApiErrorBody } from "@/types/verified-play";
import { RateLimiter } from "./rate-limit";
import { RoundError } from "./rounds/errors";
import { MAX_REQUEST_BYTES } from "./rounds/payload";

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function toErrorResponse(error: unknown) {
  if (error instanceof RoundError) return apiError(error.status, error.code, error.message);
  console.error("[api] unexpected error", error);
  return apiError(500, "server_error", "Something went wrong on our side.");
}

/** Reads a JSON body with a hard size limit. */
export async function readJsonBody(request: Request, maxBytes = MAX_REQUEST_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new RoundError("invalid_payload", "Request too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new RoundError("invalid_payload", "Request too large.");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RoundError("invalid_payload", "Invalid JSON.");
  }
}

export type AuthenticatedContext = { user: User; supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>> };

/** The verified signed-in user, or an error response (503 unconfigured, 401 signed out). */
export async function requireUser(): Promise<AuthenticatedContext | Response> {
  await connection(); // always per request, never prerendered
  const supabase = await createSupabaseServerClient();
  if (!supabase) return apiError(503, "not_configured", "Cloud accounts aren't configured on this server.");
  const user = await getVerifiedUser(supabase);
  if (!user) return apiError(401, "unauthorized", "Please sign in again.");
  return { user, supabase };
}

const limiters = new Map<string, RateLimiter>();

/** Per-user, per-action limit. Returns an error response when exceeded. */
export function rateLimit(action: string, userId: string, limit: number, windowMs = 60_000): Response | null {
  let limiter = limiters.get(action);
  if (!limiter) {
    limiter = new RateLimiter(limit, windowMs);
    limiters.set(action, limiter);
  }
  return limiter.take(userId) ? null : apiError(429, "rate_limited", "Too many requests. Please wait a moment.");
}
