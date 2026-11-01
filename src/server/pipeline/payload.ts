/**
 * Validation of submitted Pipeline Panic decisions. Only `{ decisions }` is
 * read: opportunity id → { action, discount? } for the round's own
 * opportunities. Scores, times and XP in the body are ignored.
 */
import { normalizeDecision } from "@/games/pipeline-panic/evaluate";
import type { PipelineDecision, PublicPipelineRound } from "@/games/pipeline-panic/types";
import { RoundError } from "../rounds/errors";

export function parseDecisions(body: unknown, round: Pick<PublicPipelineRound, "opportunities">): Record<string, PipelineDecision> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new RoundError("invalid_payload", "Expected a JSON object.");
  const raw = (body as Record<string, unknown>).decisions;
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new RoundError("invalid_payload", "Decisions must be an object.");
  const ids = new Set(round.opportunities.map((o) => o.id));
  const pairs = Object.entries(raw);
  if (pairs.length > ids.size) throw new RoundError("invalid_payload", "Too many decisions.");
  const decisions: Record<string, PipelineDecision> = {};
  for (const [id, value] of pairs) {
    if (!ids.has(id)) throw new RoundError("invalid_payload", "Unknown opportunity.");
    const decision = normalizeDecision(value);
    if (!decision) throw new RoundError("invalid_payload", "Invalid decision.");
    decisions[id] = decision;
  }
  return decisions;
}

/** Stored form in game_results.submission: id → "close" | "discount:10" | "defer" | "reject". */
export function encodeDecisions(decisions: Record<string, PipelineDecision>): Record<string, string> {
  return Object.fromEntries(Object.entries(decisions).map(([id, d]) => [id, d.action === "discount" ? `discount:${d.discount}` : d.action]));
}

export function decodeDecisions(stored: Record<string, string> | null | undefined): Record<string, PipelineDecision> {
  const decisions: Record<string, PipelineDecision> = {};
  for (const [id, value] of Object.entries(stored ?? {})) {
    const [action, discount] = value.split(":");
    const decision = normalizeDecision(discount === undefined ? { action } : { action, discount: Number(discount) });
    if (decision) decisions[id] = decision;
  }
  return decisions;
}
