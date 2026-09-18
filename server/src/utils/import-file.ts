import ExcelJS from "exceljs";
import { Readable } from "stream";
import { ResponseError } from "../error/response-error";

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
  sheet_name: string;
  other_sheets: string[];
};

export type SheetSelector = string | number;

// Remove invisible formatting characters and normalize non-breaking spaces.
const INVISIBLE_CHARS_RE = /[\u200B-\u200F\u2060\uFEFF]/g;
const NON_BREAKING_SPACE_RE = /\u00A0/g;

// Reapply simple digit masks that exceljs does not render.
const DIGIT_MASK_RE = /^[0#.\-\s]+$/;

function formatNumberWithDigitMask(
  value: number,
  numFmt: string,
): string | null {
  if (!Number.isInteger(value) || value < 0) return null;
  if (!DIGIT_MASK_RE.test(numFmt)) return null;

  const digitCount = (numFmt.match(/[0#]/g) || []).length;
  if (digitCount === 0) return null;

  const digits = String(value).padStart(digitCount, "0");
  if (digits.length > digitCount) return null;

  let digitIndex = 0;
  return [...numFmt]
    .map((char) => (char === "0" || char === "#" ? digits[digitIndex++] : char))
    .join("");
}

function cellToString(value: ExcelJS.CellValue, numFmt?: string): string {
  return cellToStringRaw(value, numFmt)
    .replace(INVISIBLE_CHARS_RE, "")
    .replace(NON_BREAKING_SPACE_RE, " ")
    .trim();
}

function cellToStringRaw(value: ExcelJS.CellValue, numFmt?: string): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === "number" && numFmt) {
    const masked = formatNumberWithDigitMask(value, numFmt);
    if (masked !== null) return masked;
  }
  const strValue = String(value).trim();
  if (strValue === "undefined") return "";
  if (typeof value === "object") {
    const richText = value as {
      text?: unknown;
      result?: unknown;
      formula?: unknown;
      richText?: unknown;
    };
    // HYPERLINK results contain the label, not the URL.
    if (typeof richText.formula === "string") {
      const hyperlinkMatch = richText.formula.match(
        /HYPERLINK\(\s*"([^"]+)"/i,
      );
      if (hyperlinkMatch) return hyperlinkMatch[1];

      // exceljs drops falsey formula results, so read boolean literals directly.
      const trimmedFormula = richText.formula.trim().toUpperCase();
      if (trimmedFormula === "TRUE()") return "TRUE";
      if (trimmedFormula === "FALSE()") return "FALSE";
    }
    // Flatten rich-text runs instead of stringifying the wrapper object.
    if (Array.isArray(richText.richText)) {
      return richText.richText
        .map((run) => String((run as { text?: unknown })?.text ?? ""))
        .join("")
        .trim();
    }
    if ("text" in richText) return String(richText.text ?? "").trim();
    if ("result" in richText) return String(richText.result ?? "").trim();
  }
  return strValue;
}

function selectSheet(
  worksheets: ExcelJS.Worksheet[],
  selector: SheetSelector | undefined,
): ExcelJS.Worksheet {
  if (selector === undefined) {
    return worksheets[0]!;
  }

  if (typeof selector === "number") {
    const sheet = worksheets[selector];
    if (!sheet) {
      throw new ResponseError(
        400,
        `Sheet index ${selector} does not exist. File has ${worksheets.length} sheet(s): ${worksheets.map((s) => s.name).join(", ")}`,
      );
    }
    return sheet;
  }

  const normalized = selector.trim().toLowerCase();
  const sheet = worksheets.find(
    (s) => s.name.trim().toLowerCase() === normalized,
  );
  if (!sheet) {
    throw new ResponseError(
      400,
      `Sheet "${selector}" not found. Available sheets: ${worksheets.map((s) => s.name).join(", ")}`,
    );
  }
  return sheet;
}

export async function parseImportFile(
  file: File,
  sheet?: SheetSelector,
): Promise<ParsedSheet> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  const isCsv =
    file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";

  if (isCsv) {
    await workbook.csv.read(Readable.from(buffer), { map: (datum) => datum });
  } else {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  }

  const worksheets = workbook.worksheets;
  if (worksheets.length === 0) {
    throw new ResponseError(400, "File does not contain any sheet");
  }

  const selected = selectSheet(worksheets, sheet);

  const headers: string[] = [];
  const rows: string[][] = [];
  let headerCount = 0;

  selected.eachRow((row, rowNumber) => {
    const cellCount = Math.max(row.cellCount, headerCount);
    let values: string[] = [];
    for (let col = 1; col <= cellCount; col++) {
      const cell = row.getCell(col);
      values.push(cellToString(cell.value, cell.numFmt));
    }

    if (rowNumber === 1) {
      headers.push(...values.filter((v) => v !== ""));
      headerCount = headers.length;
    } else {
      values = values.concat(Array(Math.max(0, headerCount - values.length)).fill(""));
      if (values.some((v) => v !== "")) {
        rows.push(values.slice(0, headerCount));
      }
    }
  });

  if (headers.length === 0) {
    throw new ResponseError(400, "File does not contain a header row");
  }

  return {
    headers,
    rows,
    sheet_name: selected.name,
    other_sheets: worksheets
      .filter((s) => s !== selected)
      .map((s) => s.name),
  };
}
