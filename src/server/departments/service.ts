import "server-only";
import { isCanonicalDepartmentId } from "@/config/departments";
import { toMembershipRecord, type MembershipRow } from "@/career/department-membership";
import type { SelectDepartmentResponse } from "@/types/department-career";
import { RoundError, fromDatabaseError } from "../rounds/errors";
import type { RpcCall } from "../rounds/round-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Joins or transfers the signed-in player. Only the department and a client
 * request id (for safe retries) are read from the body; eligibility and all
 * timestamps are decided by the database.
 */
export async function selectDepartment(rpc: RpcCall, userId: string, body: unknown): Promise<SelectDepartmentResponse> {
  const input = typeof body === "object" && body !== null ? (body as { departmentId?: unknown; requestId?: unknown }) : {};
  if (!isCanonicalDepartmentId(input.departmentId)) throw new RoundError("unknown_department");
  if (typeof input.requestId !== "string" || !UUID.test(input.requestId)) throw new RoundError("invalid_payload", "A request id is required.");

  let data: { status: SelectDepartmentResponse["status"]; membership: MembershipRow; next_transfer_at: string | null };
  try {
    data = (await rpc("select_department", { p_user_id: userId, p_department_id: input.departmentId, p_request_id: input.requestId })) as typeof data;
  } catch (error) {
    throw fromDatabaseError(error instanceof Error ? error.message : String(error)) ?? error;
  }
  return {
    status: data.status,
    membership: toMembershipRecord(data.membership),
    nextTransferAt: data.next_transfer_at ? new Date(data.next_transfer_at).toISOString() : null,
  };
}
