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
