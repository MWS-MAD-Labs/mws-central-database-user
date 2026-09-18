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

  // Rich-text runs must flatten to their displayed text.
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

  // Invisible formatting characters are removed before validation.
  it("strips an invisible zero-width space hidden inside a cell's text", async () => {
    const zeroWidthSpace = String.fromCharCode(0x200b);
    const file = await buildXlsxFile([
      ["Email"],
      [`sakha.askar${zeroWidthSpace}amurti@millennia21.id`],
    ]);

    const parsed = await parseImportFile(file);

    expect(parsed.rows).toEqual([["sakha.askaramurti@millennia21.id"]]);
  });

  // Numeric cells recover separators from digit-grouping masks.
  it("recovers a dot-grouped Employee ID from a number cell's numFmt mask", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.getCell(1, 1).value = "Employee ID";
    sheet.getCell(2, 1).value = 4444444;
    sheet.getCell(2, 1).numFmt = "00.00.000";
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], "test.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const parsed = await parseImportFile(file);

    expect(parsed.rows).toEqual([["44.44.444"]]);
  });

  // General numeric formats remain plain numbers.
  it("leaves a plain number cell (no digit-grouping numFmt) as-is", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.getCell(1, 1).value = "Graduation Year";
    sheet.getCell(2, 1).value = 2015;
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], "test.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const parsed = await parseImportFile(file);

    expect(parsed.rows).toEqual([["2015"]]);
  });
});
