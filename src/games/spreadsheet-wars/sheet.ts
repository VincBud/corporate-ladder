/**
 * Spreadsheet model for Spreadsheet Wars. Pure and framework-agnostic so the
 * same logic can later run on the server to validate match results.
 */

/** Zero-based cell coordinates. */
export interface CellAddress {
  row: number;
  col: number;
}

export type CellStyle = "header" | "label" | "total" | "note";

export interface Cell {
  value: string | number;
  formula?: string;
  style?: CellStyle;
}

export interface Sheet {
  name: string;
  rowCount: number;
  colCount: number;
  cells: ReadonlyMap<string, Cell>;
}

export type Direction = "up" | "down" | "left" | "right";

export function columnLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function cellKey({ row, col }: CellAddress): string {
  return `${row}:${col}`;
}

export function addressLabel({ row, col }: CellAddress): string {
  return `${columnLabel(col)}${row + 1}`;
}

export function getCell(sheet: Sheet, address: CellAddress): Cell | undefined {
  return sheet.cells.get(cellKey(address));
}

export function clampAddress(sheet: Sheet, { row, col }: CellAddress): CellAddress {
  return {
    row: Math.min(Math.max(row, 0), sheet.rowCount - 1),
    col: Math.min(Math.max(col, 0), sheet.colCount - 1),
  };
}

const DELTAS: Record<Direction, CellAddress> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

export function moveAddress(sheet: Sheet, address: CellAddress, direction: Direction): CellAddress {
  const delta = DELTAS[direction];
  return clampAddress(sheet, { row: address.row + delta.row, col: address.col + delta.col });
}
