import { addressLabel, cellKey, type Cell, type Sheet } from "./sheet";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

const LINE_ITEMS: ReadonlyArray<readonly [label: string, values: readonly number[]]> = [
  ["Synergy initiatives", [12_400, 13_850, 15_200, 18_900]],
  ["Meetings about meetings", [8_200, 9_100, 11_300, 14_750]],
  ["Strategy consultants", [22_000, 22_000, 31_500, 46_000]],
  ["Team-building escape rooms", [3_100, 0, 2_950, 6_400]],
  ["Paperclips", [180, 175, 190, 2_140]],
  ["Coffee (critical infrastructure)", [5_600, 5_900, 6_100, 7_800]],
  ["Rebranding the rebrand", [0, 15_000, 0, 27_500]],
];

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** Static preview sheet shown until real Spreadsheet Wars gameplay exists. */
export function createSampleSheet(): Sheet {
  const cells = new Map<string, Cell>();
  const set = (row: number, col: number, cell: Cell) => cells.set(cellKey({ row, col }), cell);
  const totalCol = QUARTERS.length + 1;
  const firstDataRow = 1;
  const lastDataRow = LINE_ITEMS.length;
  const totalRow = lastDataRow + 1;

  set(0, 0, { value: "Line item", style: "header" });
  QUARTERS.forEach((quarter, i) => set(0, i + 1, { value: quarter, style: "header" }));
  set(0, totalCol, { value: "Total", style: "header" });

  LINE_ITEMS.forEach(([label, values], i) => {
    const row = firstDataRow + i;
    set(row, 0, { value: label, style: "label" });
    values.forEach((value, q) => set(row, q + 1, { value }));
    set(row, totalCol, {
      value: sum(values),
      formula: `=SUM(${addressLabel({ row, col: 1 })}:${addressLabel({ row, col: QUARTERS.length })})`,
      style: "total",
    });
  });

  set(totalRow, 0, { value: "Total", style: "total" });
  for (let col = 1; col <= totalCol; col++) {
    const columnValues = LINE_ITEMS.map(([, values]) => (col === totalCol ? sum(values) : values[col - 1]));
    set(totalRow, col, {
      value: sum(columnValues),
      formula: `=SUM(${addressLabel({ row: firstDataRow, col })}:${addressLabel({ row: lastDataRow, col })})`,
      style: "total",
    });
  }

  set(totalRow + 2, 0, { value: "Status", style: "label" });
  set(totalRow + 2, 1, { value: "FINAL (v7) — do not edit", style: "note" });
  set(totalRow + 3, 0, { value: "Approved by", style: "label" });
  set(totalRow + 3, 1, { value: "Pending (since Q2)", style: "note" });

  return { name: "Q4 Forecast", rowCount: 40, colCount: 12, cells };
}
