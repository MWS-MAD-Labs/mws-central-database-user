import ExcelJS from "exceljs";
import { stringify } from "csv-stringify/sync";

export type ExportFormat = "csv" | "xlsx";

export type ExportColumn<T> = { header: string; key: keyof T & string };

export async function generateExportFile<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn<T>[],
  format: ExportFormat,
  sheetName: string,
): Promise<Buffer> {
  if (format === "csv") {
    const csv = stringify(rows, {
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
  sheet.addRows(rows);

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
  columns: { header: string; key: string }[];
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
    sheet.addRows(rows);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
