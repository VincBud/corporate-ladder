/**
 * Validation of player-submitted sheet state. The server accepts only cell
 * contents for editable cells of the round's own challenge: never scores,
 * times, XP or answers. Formulas are kept as text and evaluated by the safe
 * formula engine; invalid formulas are scored as wrong answers, not errors.
 */
import { cellKey } from "@/games/spreadsheet-wars/sheet";
import type { PublicChallenge } from "@/games/spreadsheet-wars/reconciliation-rush/public";
import type { PlayerEntries } from "@/games/spreadsheet-wars/reconciliation-rush/validate";
import { RoundError } from "./errors";

export const MAX_REQUEST_BYTES = 16_384;
export const MAX_CELL_CONTENT_LENGTH = 256;

const KEY_PATTERN = /^(\d{1,3}):(\d{1,2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertSessionId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new RoundError("invalid_payload", "Invalid round id.");
  return value.toLowerCase();
}

/** Reads `{ entries }` from a request body. Unknown fields (score, xp, …) are ignored. */
export function parseEntries(body: unknown, challenge: Pick<PublicChallenge, "cells">): PlayerEntries {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new RoundError("invalid_payload", "Expected a JSON object.");
  }
  const raw = (body as Record<string, unknown>).entries;
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new RoundError("invalid_payload", "Entries must be an object.");
  }

  const editableCount = [...challenge.cells.values()].filter((cell) => cell.editable).length;
  const pairs = Object.entries(raw);
  if (pairs.length > editableCount) throw new RoundError("invalid_payload", "Too many cells.");

  const entries: Record<string, string> = {};
  for (const [key, value] of pairs) {
    const match = KEY_PATTERN.exec(key);
    if (!match) throw new RoundError("invalid_payload", "Invalid cell reference.");
    const address = { row: Number(match[1]), col: Number(match[2]) };
    // Canonical key, so "01:3" can't alias "1:3".
    const canonical = cellKey(address);
    if (canonical !== key || !challenge.cells.get(canonical)?.editable) {
      throw new RoundError("invalid_payload", "That cell can't be edited.");
    }
    if (typeof value !== "string" || value.length > MAX_CELL_CONTENT_LENGTH) {
      throw new RoundError("invalid_payload", "Invalid cell content.");
    }
    entries[canonical] = value.trim();
  }
  return entries;
}
