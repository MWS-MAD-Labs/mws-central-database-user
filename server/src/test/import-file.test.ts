import { describe, it, expect } from "bun:test";
import ExcelJS from "exceljs";
import { parseImportFile } from "../utils/import-file";

async function buildXlsxFile(
  rows: (string | ExcelJS.CellValue)[][],
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      sheet.getCell(rowIndex + 1, colIndex + 1).value = value;
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], "test.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseImportFile - cell value parsing", () => {
  it("reads =FALSE() and =TRUE() formula cells as their literal text", async () => {
    const file = await buildXlsxFile([
      ["SN"],
      [{ formula: "FALSE()", result: false }],
      [{ formula: "TRUE()", result: true }],
    ]);

    const parsed = await parseImportFile(file);

    expect(parsed.rows).toEqual([["FALSE"], ["TRUE"]]);
  });

  it("pulls the URL out of a =HYPERLINK(...) formula cell", async () => {
    const file = await buildXlsxFile([
      ["Link"],
      [{ formula: 'HYPERLINK("https://example.com/doc","View")', result: "View" }],
    ]);

    const parsed = await parseImportFile(file);

    expect(parsed.rows).toEqual([["https://example.com/doc"]]);
  });

  it("leaves plain text and empty cells untouched", async () => {
    const file = await buildXlsxFile([
      ["Name", "Note"],
      ["Budi", ""],
    ]);

    const parsed = await parseImportFile(file);

    expect(parsed.rows).toEqual([["Budi", ""]]);
  });

  // A cell with mixed formatting (bold/colored part of the text - common
  // when a name is pasted in from Google Docs/Sheets) is `{ richText: [...]
  // }`, an array of runs - previously fell through to the literal string
  // "[object Object]" since only a flat `.text` shape was handled.
  it("joins a rich-text cell's runs into plain text", async () => {
    const file = await buildXlsxFile([
      ["Name"],
      [
        {
          richText: [
            { text: "Budi ", font: { bold: true } },
            { text: "Santoso" },
          ],
        },
      ],
    ]);

    const parsed = await parseImportFile(file);

    expect(parsed.rows).toEqual([["Budi Santoso"]]);
  });
});
