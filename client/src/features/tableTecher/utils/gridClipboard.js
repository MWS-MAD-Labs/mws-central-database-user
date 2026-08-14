// Spreadsheet clipboard format: tab between cells, newline between rows.
// Same shape Excel and Google Sheets use, so copy/paste works across apps.
export function toClipboardText(matrix) {
  return matrix
    .map((row) => row.map((cell) => normalizeCell(cell)).join('\t'))
    .join('\n')
}

export function parseClipboardText(text) {
  if (!text) return []

  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => line.split('\t'))
}

function normalizeCell(value) {
  if (value === null || value === undefined) return ''
  // Tabs and newlines inside a value would break the grid shape.
  return String(value).replace(/[\t\n\r]/g, ' ')
}
