// Works out where an upload came from (an .xlsx or .csv file, a pair of CSV files, or a
// public Google Sheets link) and turns it into { events, transactions } sheets.

import { MAX_FILE_BYTES, parseCsv, parseXlsx } from './parse.js'

// Only docs.google.com spreadsheet links are accepted, and the export address is built
// here from the sheet id, so a visitor can never make the server fetch another site.
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/

export class UploadError extends Error {}

function isXlsx(bytes) {
  // .xlsx files are zip archives, which start with the letters "PK".
  return bytes.byteLength > 3 && new Uint8Array(bytes)[0] === 0x50 && new Uint8Array(bytes)[1] === 0x4b
}

function cleanFilename(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '')
  return base.slice(0, 100) || 'upload'
}

async function fileBytes(file) {
  if (file.size > MAX_FILE_BYTES) throw new UploadError('The file is larger than 1 MB.')
  return file.arrayBuffer()
}

async function fetchGoogleSheet(url, fetchFn) {
  const match = SHEET_URL.exec(String(url).trim())
  if (!match) throw new UploadError('That does not look like a Google Sheets link (it should start with https://docs.google.com/spreadsheets/d/).')
  const exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`
  let response
  try {
    response = await fetchFn(exportUrl, { redirect: 'follow' })
  } catch {
    throw new UploadError('Could not reach Google Sheets. Try again, or download the sheet as .xlsx and upload that.')
  }
  const length = Number(response.headers.get('content-length') ?? 0)
  if (!response.ok || length > MAX_FILE_BYTES) {
    throw new UploadError('Could not read that Google Sheet. Check that sharing is set to "Anyone with the link" (Viewer).')
  }
  const bytes = await response.arrayBuffer()
  if (!isXlsx(bytes)) {
    throw new UploadError('Google did not return a spreadsheet. Check that sharing is set to "Anyone with the link" (Viewer).')
  }
  return bytes
}

/**
 * @param {FormData} form  fields: sheet_url, file, transactions_file
 * @returns {{ sheets: {events, transactions}, filename: string }}
 */
export async function sheetsFromForm(form, fetchFn = fetch) {
  const sheetUrl = form.get('sheet_url')
  const file = form.get('file')
  const txnFile = form.get('transactions_file')
  const hasFile = file && typeof file !== 'string' && file.size > 0

  if (sheetUrl && String(sheetUrl).trim()) {
    return { sheets: await parseXlsx(await fetchGoogleSheet(sheetUrl, fetchFn)), filename: 'Google Sheet' }
  }
  if (!hasFile) throw new UploadError('Choose a file or paste a Google Sheets link.')

  const bytes = await fileBytes(file)
  const filename = cleanFilename(file.name)
  if (isXlsx(bytes)) return { sheets: await parseXlsx(bytes), filename }

  // Otherwise treat it as a CSV of events, with an optional second CSV of transactions.
  const decode = (b) => new TextDecoder('utf-8', { fatal: false }).decode(b)
  const sheets = { events: parseCsv(decode(bytes)), transactions: null }
  if (txnFile && typeof txnFile !== 'string' && txnFile.size > 0) {
    sheets.transactions = parseCsv(decode(await fileBytes(txnFile)))
  }
  return { sheets, filename }
}
