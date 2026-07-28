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
  selected.eachRow((row, rowNumber) => {
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

  return {
    headers,
    rows,
    sheet_name: selected.name,
    other_sheets: worksheets
      .filter((s) => s !== selected)
      .map((s) => s.name),
  };
}
