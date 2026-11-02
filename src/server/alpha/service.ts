/**
 * Closed alpha access (trusted server code). The database enforces
 * invitations when an account is created (enforce_alpha_invitation trigger);
 * this module only answers the registration form's questions.
 */
import { looksLikeInviteCode } from "@/alpha/invite-format";
import type { RpcCall } from "../rounds/round-store";

export async function getAlphaAccess(rpc: RpcCall | null): Promise<{ inviteRequired: boolean }> {
  if (!rpc) return { inviteRequired: false };
  const data = (await rpc("get_alpha_access", {})) as { invite_required?: boolean } | null;
  return { inviteRequired: Boolean(data?.invite_required) };
}

/** Whether a code can still be used. Malformed input never reaches the database. */
export async function checkInvitation(rpc: RpcCall, code: unknown): Promise<boolean> {
  if (typeof code !== "string" || code.length > 40 || !looksLikeInviteCode(code)) return false;
  return Boolean(await rpc("check_alpha_invitation", { p_code: code }));
}
