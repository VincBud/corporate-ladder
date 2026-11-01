/** What players see before a round is final: every fact, but no seed and no scenario labels. */
import type { PipelineRound, PublicPipelineRound } from "./types";

export function toPublicPipelineRound(round: PipelineRound): PublicPipelineRound {
  return {
    quarterLabel: round.quarterLabel,
    playbook: { ...round.playbook, restrictedClauses: [...round.playbook.restrictedClauses] },
    opportunities: round.opportunities.map((o) => ({
      ...o,
      contact: { ...o.contact },
      email: { ...o.email, body: [...o.email.body] },
      notes: [...o.notes],
      clauses: [...o.clauses],
    })),
  };
}
