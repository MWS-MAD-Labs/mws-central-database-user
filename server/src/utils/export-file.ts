import ExcelJS from "exceljs";
import { stringify } from "csv-stringify/sync";

export type ExportFormat = "csv" | "xlsx";

export type ExportColumn<T> = {
  header: string;
  key: keyof T & string;
  // Enum fields get an Excel dropdown so an admin editing the exported
  // sheet offline can only pick a value the app would actually accept.
  options?: string[];
};

// CSV Injection / Formula Injection (OWASP): a cell whose text starts with
// = + - @ (or a tab/CR, which some parsers also treat as a formula lead-in)
// gets executed as a formula the moment a human opens the export in Excel
// or Sheets. Any free-text field a bulk import writes (name, notes,
// address, health description, ...) is attacker-controlled input by the
// time it round-trips through export, so every string cell gets the same
// treatment - not just ones obviously tied to import.
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

// Prisma DateTime fields serialize as full ISO-8601 ("2026-07-28T07:07:31.571Z"),
// which is noisy to read in a spreadsheet. Reformat to a plain UTC date (or
// date + hour:minute if the field carries a real time-of-day, e.g. created_at)
// so admins aren't staring at milliseconds and a trailing "Z".
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function formatDateForSpreadsheet(value: string): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const isMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0;
  return isMidnight
    ? datePart
    : `${datePart} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function sanitizeCellValue(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  if (ISO_DATETIME_RE.test(value)) return formatDateForSpreadsheet(value);
  return FORMULA_TRIGGER_CHARS.has(value[0]) ? `'${value}` : value;
}

function sanitizeRowsForSpreadsheet<T extends Record<string, unknown>>(
  rows: T[],
): T[] {
  return rows.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          sanitizeCellValue(value),
        ]),
      ) as T,
  );
}

const MIN_COLUMN_WIDTH = 10;
const MAX_COLUMN_WIDTH = 60;
const COLUMN_WIDTH_PADDING = 4;
const SHEET_FONT_NAME = "Times New Roman";
const HEADER_FILL_ARGB = "FF7E1518";
const HEADER_FONT_COLOR_ARGB = "FFFFFFFF";

// Short, fixed-value columns (record IDs and enum/dropdown fields) read
// better centered; free-text fields (names, addresses, notes) read better
// left-aligned like normal prose.
function isCenterAlignedColumn(key: string, hasOptions: boolean): boolean {
  return hasOptions || key === "id" || key.endsWith("_id");
}

// Bold, colored header (frozen in place while scrolling), Times New Roman
// throughout, per-column alignment, column width sized to the longer of the
// header or its longest cell (padded so a header like "Employment Type"
// doesn't get visually clipped), and a dropdown on enum columns so an
// offline edit can't drift from a value the app would accept.
function styleWorksheet(
  sheet: ExcelJS.Worksheet,
  columns: { header: string; key: string; options?: string[] }[],
  rows: Record<string, unknown>[],
): void {
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  sheet.columns.forEach((column, index) => {
    const source = columns[index];
    const header = source?.header ?? "";
    const key = source?.key ?? "";
    const hasOptions = !!source?.options?.length;
    const longestValue = rows.reduce((max, row) => {
      const value = key ? row[key] : undefined;
      const length = value === null || value === undefined ? 0 : String(value).length;
      return Math.max(max, length);
    }, header.length);
    column.width = Math.min(
      Math.max(longestValue + COLUMN_WIDTH_PADDING, MIN_COLUMN_WIDTH),
      MAX_COLUMN_WIDTH,
    );
    column.font = { name: SHEET_FONT_NAME };
    column.alignment = {
      horizontal: isCenterAlignedColumn(key, hasOptions) ? "center" : "left",
      vertical: "middle",
    };

    if (hasOptions) {
      const formula = `"${source!.options!.join(",")}"`;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        sheet.getCell(rowIndex + 2, index + 1).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [formula],
        };
      }
    }
  });

  const headerRow = sheet.getRow(1);
  headerRow.height = 20;
  columns.forEach((_, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.font = {
      name: SHEET_FONT_NAME,
      bold: true,
      color: { argb: HEADER_FONT_COLOR_ARGB },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL_ARGB },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
}

export async function generateExportFile<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn<T>[],
  format: ExportFormat,
  sheetName: string,
): Promise<Buffer> {
  const safeRows = sanitizeRowsForSpreadsheet(rows);

  if (format === "csv") {
    const csv = stringify(safeRows, {
      header: true,
      columns: columns.map((column) => ({
        key: column.key,
        header: column.header,
      })),
    });
    return Buffer.from(csv, "utf-8");
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
  }));
  sheet.addRows(safeRows);
  styleWorksheet(sheet, columns, safeRows);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function exportMimeType(format: ExportFormat): string {
  return format === "csv"
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export type ExportSheet<T extends Record<string, unknown>> = {
  name: string;
  rows: T[];
  columns: ExportColumn<T>[];
};

// A workbook holds sheets with different row shapes, so the array handed to
// generateMultiSheetExportFile can't share one T. Each sheet keeps its own
// keyof-checked ExportSheet<T> at the point it's declared/built, then gets
// downgraded to this plain shape (string key, not keyof T) right before
// going into the heterogeneous list - avoids `any` without fighting
// TS's variance handling for `keyof T` across different T's.
export type PlainExportSheet = {
  name: string;
  rows: Record<string, unknown>[];
  columns: { header: string; key: string; options?: string[] }[];
};

export function toPlainSheet<T extends Record<string, unknown>>(
  sheet: ExportSheet<T>,
): PlainExportSheet {
  return { name: sheet.name, rows: sheet.rows, columns: sheet.columns };
}

// CSV can only hold one table, so extra sheets are dropped and only the
// first is written. xlsx gets one worksheet per entry.
export async function generateMultiSheetExportFile(
  sheets: PlainExportSheet[],
  format: ExportFormat,
): Promise<Buffer> {
  if (format === "csv") {
    const [first] = sheets;
    return generateExportFile(first.rows, first.columns, format, first.name);
  }

  const workbook = new ExcelJS.Workbook();
  for (const { name, rows, columns } of sheets) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns.map((column) => ({
      header: column.header,
      key: column.key,
    }));
    const safeRows = sanitizeRowsForSpreadsheet(rows);
    sheet.addRows(safeRows);
    styleWorksheet(sheet, columns, safeRows);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
