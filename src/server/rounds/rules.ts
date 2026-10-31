/**
 * Rules versions the server can verify. A session pins the version it was
 * created with; the generator for that version rebuilds its exact challenge.
 * When generation or scoring changes, add a new version and keep the old
 * entry until its sessions are no longer needed.
 */
import { generateChallenge } from "@/games/spreadsheet-wars/reconciliation-rush/generate";
import type { Challenge } from "@/games/spreadsheet-wars/reconciliation-rush/types";
import { RoundError } from "./errors";

export const RECONCILIATION_RUSH = "reconciliation-rush";

const GENERATORS: Readonly<Record<number, (seed: string) => Challenge>> = {
  1: generateChallenge,
};

export function isSupportedRulesVersion(version: number): boolean {
  return version in GENERATORS;
}

export function challengeFor(rulesVersion: number, seed: string): Challenge {
  const generate = GENERATORS[rulesVersion];
  if (!generate) throw new RoundError("unsupported_rules");
  return generate(seed);
}
