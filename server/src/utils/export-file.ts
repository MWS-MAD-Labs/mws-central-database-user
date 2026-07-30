import ExcelJS from "exceljs";
import { stringify } from "csv-stringify/sync";

export type ExportFormat = "csv" | "xlsx";

export type ExportColumn<T> = {
  header: string;
  key: keyof T & string;
  // Enum fields get an Excel dropdown so offline edits stay within accepted values.
  options?: string[];
};

// CSV/Formula injection (OWASP): a cell starting with = + - @ (or tab/CR)
// executes as a formula on open. Every string cell gets escaped, not just
// ones obviously tied to import.
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

// Prisma DateTime fields serialize as full ISO-8601 - reformat to a plain
// UTC date (or date + time if the field has a real time-of-day, e.g. created_at).
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

// Zebra striping - odd rows stay white, even rows get gray. (Per-value cell
// colors were tried and dropped - a fill can't react to dropdown edits.)
const ZEBRA_EVEN_ROW_ARGB = "FFE8E8E8";

// IDs and enum/dropdown columns read better centered; free-text reads
// better left-aligned.
function isCenterAlignedColumn(key: string, hasOptions: boolean): boolean {
  return hasOptions || key === "id" || key.endsWith("_id");
}

// Bold colored frozen header, Times New Roman, per-column alignment, width
// sized to the longer of header/cell, dropdown validation on enum columns.
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

  // Zebra stripe: even visible rows get the tint, odd stay white.
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 2) {
    const excelRow = sheet.getRow(rowIndex + 2);
    columns.forEach((_, columnIndex) => {
      excelRow.getCell(columnIndex + 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: ZEBRA_EVEN_ROW_ARGB },
      };
    });
  }
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

// Each sheet has its own T, so the array can't share one keyof T. Downgrade
// to plain string keys here instead of reaching for `any`.
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
