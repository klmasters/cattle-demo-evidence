// Turns an uploaded file into the sheet shape validate.js expects:
//   { headers: ['tag_number', ...], rows: [{ row: 2, values: { tag_number: '248', ... } }] }
// Row numbers match the spreadsheet (header is row 1), so error messages point at the right row.

import readExcelFile from 'read-excel-file/universal'
import Papa from 'papaparse'

export const MAX_FILE_BYTES = 1024 * 1024

// "Event Date " -> "event_date"
function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

// grid: array of rows, each an array of cell values; the first row is the header.
export function sheetFromGrid(grid) {
  if (!grid || grid.length === 0) return { headers: [], rows: [] }
  const headers = grid[0].map(normalizeHeader)
  const rows = grid.slice(1).map((cells, i) => {
    const values = {}
    headers.forEach((h, col) => {
      if (h) values[h] = cells[col] ?? null
    })
    return { row: i + 2, values }
  })
  return { headers: headers.filter(Boolean), rows }
}

// bytes: ArrayBuffer of an .xlsx file (an upload, or Google Sheets' xlsx export).
// Returns { events, transactions }; a missing tab comes back as null.
export async function parseXlsx(bytes) {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('The file is larger than 1 MB.')
  let sheets
  try {
    sheets = await readExcelFile(bytes)
  } catch {
    throw new Error('Could not read the file as an Excel (.xlsx) workbook.')
  }
  const find = (name) => sheets.find((s) => s.sheet.trim().toLowerCase() === name)
  const events = find('events')
  const transactions = find('transactions')
  return {
    events: events ? sheetFromGrid(events.data) : null,
    transactions: transactions ? sheetFromGrid(transactions.data) : null,
  }
}

// text: the contents of one CSV file.
export function parseCsv(text) {
  if (text.length > MAX_FILE_BYTES) throw new Error('The file is larger than 1 MB.')
  const result = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' })
  return sheetFromGrid(result.data)
}
