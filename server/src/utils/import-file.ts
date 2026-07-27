import ExcelJS from "exceljs";
import { Readable } from "stream";
import { ResponseError } from "../error/response-error";

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
};

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const richText = value as { text?: unknown; result?: unknown };
    if ("text" in richText) return String(richText.text ?? "").trim();
    if ("result" in richText) return String(richText.result ?? "").trim();
  }
  return String(value).trim();
}

export async function parseImportFile(file: File): Promise<ParsedSheet> {
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

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ResponseError(400, "File does not contain any sheet");
  }

  const headers: string[] = [];
  const rows: string[][] = [];
  sheet.eachRow((row, rowNumber) => {
    const values = (row.values as ExcelJS.CellValue[])
      .slice(1)
      .map(cellToString);
    if (rowNumber === 1) {
      headers.push(...values);
    } else if (values.some((v) => v !== "")) {
      rows.push(values);
    }
  });

  if (headers.length === 0) {
    throw new ResponseError(400, "File does not contain a header row");
  }

  return { headers, rows };
}
