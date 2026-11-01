/**
 * Pipeline Panic rules versions the server can verify. A session pins its
 * version; that version's generator rebuilds the exact round from the seed.
 */
import { generatePipelineRound } from "@/games/pipeline-panic/generate";
import type { PipelineRound } from "@/games/pipeline-panic/types";
import { RoundError } from "../rounds/errors";

export const PIPELINE_PANIC = "pipeline-panic";

const GENERATORS: Readonly<Record<number, (seed: string) => PipelineRound>> = {
  1: generatePipelineRound,
};

export function pipelineRoundFor(rulesVersion: number, seed: string): PipelineRound {
  const generate = GENERATORS[rulesVersion];
  if (!generate) throw new RoundError("unsupported_rules");
  return generate(seed);
}
