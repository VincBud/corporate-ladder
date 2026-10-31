/**
 * What a player may see of a challenge, and how challenges travel over JSON.
 *
 * A PublicChallenge has no solutions, no planted-error metadata and no seed
 * (the seed alone regenerates every answer). It is built field by field, so
 * new secret fields are excluded by default rather than leaked by a spread.
 */
import type { Challenge, ChallengeCell, PlantedError, SourceDocument } from "./types";

export type PublicCell = Omit<ChallengeCell, "solution">;

export interface PublicChallenge {
  templateId: string;
  department: string;
  title: string;
  fileName: string;
  rowCount: number;
  colCount: number;
  ledgerRowCount: number;
  cells: ReadonlyMap<string, PublicCell>;
  documents: readonly SourceDocument[];
}

export interface SerializedPublicChallenge extends Omit<PublicChallenge, "cells"> {
  cells: Array<[key: string, cell: PublicCell]>;
}

/** Full challenge for post-round review, only sent once a round is finalized. */
export interface SerializedChallenge extends Omit<Challenge, "cells"> {
  cells: Array<[key: string, cell: ChallengeCell]>;
}

export function toPublicChallenge(challenge: Challenge): PublicChallenge {
  const cells = new Map<string, PublicCell>();
  for (const [key, cell] of challenge.cells) {
    cells.set(key, {
      address: { row: cell.address.row, col: cell.address.col },
      role: cell.role,
      format: cell.format,
      editable: cell.editable,
      initial: cell.initial,
    });
  }
  return {
    templateId: challenge.templateId,
    department: challenge.department,
    title: challenge.title,
    fileName: challenge.fileName,
    rowCount: challenge.rowCount,
    colCount: challenge.colCount,
    ledgerRowCount: challenge.ledgerRowCount,
    cells,
    documents: challenge.documents,
  };
}

export function serializePublicChallenge(challenge: PublicChallenge): SerializedPublicChallenge {
  return { ...challenge, cells: [...challenge.cells] };
}

export function deserializePublicChallenge(data: SerializedPublicChallenge): PublicChallenge {
  return { ...data, cells: new Map(data.cells) };
}

export function serializeChallenge(challenge: Challenge): SerializedChallenge {
  return { ...challenge, cells: [...challenge.cells] };
}

export function deserializeChallenge(data: SerializedChallenge): Challenge {
  return { ...data, cells: new Map(data.cells), errors: data.errors as readonly PlantedError[] };
}
