/**
 * A deliberately small, safe spreadsheet formula engine.
 *
 * Supported: numbers, cell references (A1), + - * /, unary minus, parentheses
 * and SUM() over references, ranges (A1:A9) and numbers. Nothing is ever
 * executed as code: input is tokenized and parsed into a tiny AST, and every
 * failure becomes a spreadsheet error value rather than an exception.
 */
import { cellKey, type CellAddress } from "./sheet";

export type FormulaError = "#PARSE!" | "#REF!" | "#VALUE!" | "#DIV/0!" | "#CYCLE!" | "#NAME?";

export type CellValue =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "empty" }
  | { kind: "error"; error: FormulaError };

export interface SheetSource {
  rowCount: number;
  colCount: number;
  /** Raw cell content as typed: "42", "Paper clips" or "=D2*E2". */
  getContent: (address: CellAddress) => string | undefined;
}

type Node =
  | { type: "number"; value: number }
  | { type: "ref"; address: CellAddress }
  | { type: "range"; from: CellAddress; to: CellAddress }
  | { type: "unary"; operand: Node }
  | { type: "binary"; op: "+" | "-" | "*" | "/"; left: Node; right: Node }
  | { type: "sum"; args: Node[] };

type Token =
  | { type: "number"; value: number }
  | { type: "ref"; address: CellAddress }
  | { type: "ident"; name: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" | ":" | "," };

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: "#PARSE!" | "#NAME?" };

const MAX_FORMULA_LENGTH = 256;
const MAX_DEPTH = 32;
const MAX_RANGE_CELLS = 1_000;

const num = (value: number): CellValue => ({ kind: "number", value });
const err = (error: FormulaError): CellValue => ({ kind: "error", error });

class ParseFailure extends Error {
  constructor(readonly code: "#PARSE!" | "#NAME?") {
    super(code);
  }
}

/** "B12" → { row: 11, col: 1 }. Accepts optional $ anchors. Returns null for anything else. */
export function parseAddress(text: string): CellAddress | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,5})$/.exec(text.trim());
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let col = 0;
  for (const letter of letters) col = col * 26 + (letter.charCodeAt(0) - 64);
  const row = Number(match[2]);
  if (row < 1) return null;
  return { row: row - 1, col: col - 1 };
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (char === " " || char === "\t") {
      i++;
      continue;
    }
    if ("+-*/():,".includes(char)) {
      tokens.push({ type: "op", value: char as Extract<Token, { type: "op" }>["value"] });
      i++;
      continue;
    }
    const numberMatch = /^(\d+(\.\d+)?|\.\d+)/.exec(input.slice(i));
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]) });
      i += numberMatch[0].length;
      continue;
    }
    const wordMatch = /^\$?[A-Za-z]+\$?\d*/.exec(input.slice(i));
    if (wordMatch) {
      const word = wordMatch[0];
      const address = /\d/.test(word) ? parseAddress(word) : null;
      if (address) tokens.push({ type: "ref", address });
      else if (/^[A-Za-z]+$/.test(word)) tokens.push({ type: "ident", name: word.toUpperCase() });
      else throw new ParseFailure("#PARSE!");
      i += word.length;
      continue;
    }
    throw new ParseFailure("#PARSE!");
  }
  return tokens;
}

/** Parses the text after the leading "=". */
export function parseFormula(body: string): ParseResult {
  if (body.length > MAX_FORMULA_LENGTH) return { ok: false, error: "#PARSE!" };
  try {
    const tokens = tokenize(body);
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (value: string) => {
      const token = peek();
      return token?.type === "op" && token.value === value;
    };
    const expectOp = (value: string) => {
      if (!isOp(value)) throw new ParseFailure("#PARSE!");
      pos++;
    };

    function expression(depth: number): Node {
      if (depth > MAX_DEPTH) throw new ParseFailure("#PARSE!");
      let node = term(depth);
      while (isOp("+") || isOp("-")) {
        const op = (tokens[pos++] as { value: "+" | "-" }).value;
        node = { type: "binary", op, left: node, right: term(depth) };
      }
      return node;
    }

    function term(depth: number): Node {
      let node = factor(depth);
      while (isOp("*") || isOp("/")) {
        const op = (tokens[pos++] as { value: "*" | "/" }).value;
        node = { type: "binary", op, left: node, right: factor(depth) };
      }
      return node;
    }

    function factor(depth: number): Node {
      if (depth > MAX_DEPTH) throw new ParseFailure("#PARSE!");
      const token = peek();
      if (!token) throw new ParseFailure("#PARSE!");

      if (token.type === "op" && (token.value === "-" || token.value === "+")) {
        pos++;
        const operand = factor(depth + 1);
        return token.value === "-" ? { type: "unary", operand } : operand;
      }
      if (token.type === "op" && token.value === "(") {
        pos++;
        const inner = expression(depth + 1);
        expectOp(")");
        return inner;
      }
      if (token.type === "number") {
        pos++;
        return { type: "number", value: token.value };
      }
      if (token.type === "ref") {
        pos++;
        if (isOp(":")) throw new ParseFailure("#PARSE!"); // bare ranges only inside SUM
        return { type: "ref", address: token.address };
      }
      if (token.type === "ident") {
        pos++;
        if (token.name !== "SUM") throw new ParseFailure("#NAME?");
        expectOp("(");
        const args: Node[] = [];
        if (!isOp(")")) {
          for (;;) {
            args.push(sumArgument(depth + 1));
            if (!isOp(",")) break;
            pos++;
          }
        }
        expectOp(")");
        return { type: "sum", args };
      }
      throw new ParseFailure("#PARSE!");
    }

    function sumArgument(depth: number): Node {
      const token = peek();
      const next = tokens[pos + 1];
      if (token?.type === "ref" && next?.type === "op" && next.value === ":") {
        const end = tokens[pos + 2];
        if (end?.type !== "ref") throw new ParseFailure("#PARSE!");
        pos += 3;
        return { type: "range", from: token.address, to: end.address };
      }
      return expression(depth);
    }

    if (tokens.length === 0) return { ok: false, error: "#PARSE!" };
    const ast = expression(0);
    if (pos !== tokens.length) return { ok: false, error: "#PARSE!" };
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, error: error.code };
    throw error;
  }
}

/** Parses typed non-formula content: numbers (commas and "$" allowed), text, or empty. */
export function parseLiteral(content: string): CellValue {
  const trimmed = content.trim();
  if (trimmed === "") return { kind: "empty" };
  const numeric = trimmed.replace(/[$,\s]/g, "");
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(numeric)) return num(Number(numeric));
  return { kind: "text", value: trimmed };
}

export const isFormula = (content: string | undefined) => content?.trim().startsWith("=") ?? false;

/**
 * Lazily evaluates cells of a sheet with memoization and cycle detection.
 * Create one per snapshot of sheet contents.
 */
export class SheetEvaluator {
  private readonly cache = new Map<string, CellValue>();
  private readonly visiting = new Set<string>();

  constructor(private readonly source: SheetSource) {}

  value(address: CellAddress): CellValue {
    const { rowCount, colCount } = this.source;
    if (address.row < 0 || address.col < 0 || address.row >= rowCount || address.col >= colCount) return err("#REF!");

    const key = cellKey(address);
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.visiting.has(key)) return err("#CYCLE!");

    this.visiting.add(key);
    const content = this.source.getContent(address) ?? "";
    const result = isFormula(content) ? this.evaluateFormula(content.trim().slice(1)) : parseLiteral(content);
    this.visiting.delete(key);
    this.cache.set(key, result);
    return result;
  }

  private evaluateFormula(body: string): CellValue {
    const parsed = parseFormula(body);
    if (!parsed.ok) return err(parsed.error);
    const result = this.evaluateNode(parsed.ast);
    if (result.kind === "number" && !Number.isFinite(result.value)) return err("#VALUE!");
    return result;
  }

  private evaluateNode(node: Node): CellValue {
    switch (node.type) {
      case "number":
        return num(node.value);
      case "ref": {
        const value = this.value(node.address);
        if (value.kind === "empty") return num(0);
        if (value.kind === "text") return err("#VALUE!");
        return value;
      }
      case "range":
        return err("#VALUE!");
      case "unary": {
        const operand = this.evaluateNode(node.operand);
        return operand.kind === "number" ? num(-operand.value) : operand;
      }
      case "binary": {
        const left = this.evaluateNode(node.left);
        if (left.kind !== "number") return left;
        const right = this.evaluateNode(node.right);
        if (right.kind !== "number") return right;
        return applyOperator(node.op, left.value, right.value);
      }
      case "sum": {
        let total = 0;
        for (const arg of node.args) {
          if (arg.type === "range") {
            const rows = [Math.min(arg.from.row, arg.to.row), Math.max(arg.from.row, arg.to.row)];
            const cols = [Math.min(arg.from.col, arg.to.col), Math.max(arg.from.col, arg.to.col)];
            if ((rows[1] - rows[0] + 1) * (cols[1] - cols[0] + 1) > MAX_RANGE_CELLS) return err("#REF!");
            for (let row = rows[0]; row <= rows[1]; row++) {
              for (let col = cols[0]; col <= cols[1]; col++) {
                const value = this.value({ row, col });
                if (value.kind === "error") return value;
                // Like real spreadsheets, SUM ignores text and blanks inside ranges.
                if (value.kind === "number") total += value.value;
              }
            }
          } else {
            const value = this.evaluateNode(arg);
            if (value.kind !== "number") return value.kind === "error" ? value : err("#VALUE!");
            total += value.value;
          }
        }
        return num(total);
      }
    }
  }
}

function applyOperator(op: "+" | "-" | "*" | "/", left: number, right: number): CellValue {
  switch (op) {
    case "+":
      return num(left + right);
    case "-":
      return num(left - right);
    case "*":
      return num(left * right);
    case "/":
      return right === 0 ? err("#DIV/0!") : num(left / right);
  }
}

/** Evaluates a single cell of a sheet. */
export function evaluateCell(source: SheetSource, address: CellAddress): CellValue {
  return new SheetEvaluator(source).value(address);
}

/**
 * Canonical form of raw content, used to decide whether the player changed a
 * cell: numbers compare by value, formulas ignore case and whitespace.
 */
export function normalizeContent(content: string | undefined): string {
  const trimmed = (content ?? "").trim();
  if (isFormula(trimmed)) return trimmed.replace(/\s+/g, "").replace(/\$/g, "").toUpperCase();
  const literal = parseLiteral(trimmed);
  if (literal.kind === "number") return `#${literal.value}`;
  return trimmed;
}
