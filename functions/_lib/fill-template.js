// Fills the blank upload template with rows and returns a new .xlsx.
//
// The template (static/cattle_upload_template.xlsx) is a zip of XML files. Rather than
// rebuild the workbook, which would lose its dropdowns and header notes, this unzips it,
// writes cells into the Events, Transactions and Herd sheets, and zips it again.
//   Events:       pre-filled rows (any of the 14 columns; a blank value leaves the cell empty)
//   Transactions: optional pre-filled rows (any of the 7 columns)
//   Herd:         the reference tab, rewritten from the live herd, and the Events tag dropdown
//                 is pointed at the new length of that list
// Everything else in the file (validation, header notes) is untouched.

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

export const MAX_FILL_ROWS = 500 // the template's validation covers rows 2..501

// Style numbers in the template's styles.xml.
const TEXT = 3 // text (so 0012 stays 0012)
const DATE = 4 // yyyy-mm-dd
const MONEY = 5 // $#,##0.00

// One entry per template column, in order. kind says how a value is written:
//   text/date/money carry the template's style; str and number are plain.
// `styled` marks columns the template formats even when empty; a filled row keeps them
// (an empty styled cell) so the formatting is not lost.
const EVENT_COLUMNS = [
  { name: 'tag_number', kind: 'text', style: TEXT, styled: true },
  { name: 'event_date', kind: 'date', style: DATE, styled: true },
  { name: 'event_type', kind: 'str' },
  { name: 'location', kind: 'str' },
  { name: 'breed', kind: 'str' },
  { name: 'type', kind: 'str' },
  { name: 'weight_lbs', kind: 'number' },
  { name: 'notes', kind: 'str' },
  { name: 'mother_tag_number', kind: 'text', style: TEXT, styled: true },
  { name: 'previous_tag_number', kind: 'text', style: TEXT, styled: true },
  { name: 'birth_year', kind: 'number' },
  { name: 'estimated_preg_date', kind: 'date', style: DATE, styled: true },
  { name: 'estimated_months_pregnant', kind: 'number' },
  { name: 'estimated_due_month', kind: 'date', style: DATE, styled: true },
]
const TRANSACTION_COLUMNS = [
  { name: 'transaction_date', kind: 'date', style: DATE, styled: true },
  { name: 'transaction_type', kind: 'str' },
  { name: 'tag_numbers', kind: 'text', style: TEXT, styled: true },
  { name: 'head_count', kind: 'number' },
  { name: 'price_per_head', kind: 'number', style: MONEY, styled: true },
  { name: 'total_amount', kind: 'number', style: MONEY, styled: true },
  { name: 'notes', kind: 'str' },
]
const HERD_COLUMN_COUNT = 8 // tag_number .. last_weight_date

const letter = (index) => String.fromCharCode(65 + index) // 0 -> A (the sheets here stay under 26 columns)

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// '2026-05-28' -> 46170 (days since 1899-12-30, how Excel stores dates)
export function excelSerial(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate))
  if (!match) throw new Error(`Not a date: ${isoDate}`)
  const days = Date.UTC(+match[1], +match[2] - 1, +match[3]) / 86400000
  return days + 25569
}

function textCell(ref, value, style) {
  const s = style === undefined ? '' : ` s="${style}"`
  return `<c r="${ref}"${s} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
}

function numberCell(ref, value, style) {
  const s = style === undefined ? '' : ` s="${style}"`
  return `<c r="${ref}"${s} t="n"><v>${value}</v></c>`
}

const isBlank = (value) => value === undefined || value === null || value === ''

// One row of cells. A blank value is left out, or written as an empty styled cell where the template styles it.
function rowXml(r, values, columns) {
  const cells = []
  columns.forEach((col, i) => {
    const ref = `${letter(i)}${r}`
    const value = values[col.name]
    if (isBlank(value)) {
      if (col.styled) cells.push(`<c r="${ref}" s="${col.style}" t="n" />`)
    } else if (col.kind === 'date') {
      cells.push(numberCell(ref, excelSerial(value), col.style))
    } else if (col.kind === 'number') {
      cells.push(numberCell(ref, Number(value), col.style))
    } else {
      cells.push(textCell(ref, value, col.style)) // text and str
    }
  })
  return `<row r="${r}">${cells.join('')}</row>`
}

// Replace rows 2.. of a sheet with the given rows; rows after them stay as the template has them.
function fillRows(sheetXml, rows, columns, sheetName) {
  let xml = sheetXml
  rows.forEach((values, i) => {
    const r = i + 2
    const pattern = new RegExp(`<row r="${r}">.*?</row>`)
    if (!pattern.test(xml)) throw new Error(`The template has no row ${r} on the ${sheetName} tab.`)
    xml = xml.replace(pattern, () => rowXml(r, values, columns))
  })
  return xml
}

// Tags sort numerically when they are all digits, so 99 comes before 101 (same as make_template.py).
export function byTag(a, b) {
  const x = String(a.tag_number)
  const y = String(b.tag_number)
  const xd = /^\d+$/.test(x)
  const yd = /^\d+$/.test(y)
  if (xd && yd) return Number(x) - Number(y) || x.localeCompare(y)
  if (xd !== yd) return xd ? -1 : 1
  return x.localeCompare(y)
}

function sheetPath(workbookXml, relsXml, name) {
  const sheet = new RegExp(`<sheet [^>]*name="${name}"[^>]*r:id="([^"]+)"`).exec(workbookXml)
  if (!sheet) throw new Error(`The template has no ${name} tab.`)
  const rel = new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${sheet[1]}"|<Relationship [^>]*Id="${sheet[1]}"[^>]*Target="([^"]+)"`).exec(relsXml)
  if (!rel) throw new Error(`The template has no file for the ${name} tab.`)
  const target = rel[1] || rel[2]
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`
}

// templateBytes: Uint8Array of the blank template.
// events:       [{ tag_number, event_date: 'YYYY-MM-DD', event_type, location, breed, type, weight_lbs, notes,
//                  mother_tag_number, previous_tag_number, birth_year, estimated_preg_date,
//                  estimated_months_pregnant, estimated_due_month }]  (any may be left out)
// transactions: [{ transaction_date, transaction_type, tag_numbers, head_count, price_per_head, total_amount, notes }]
// herd:         [{ tag_number, breed, type, location, last_event_type, last_event_date, last_weight_lbs, last_weight_date }]
export function fillTemplate(templateBytes, { events, transactions = [], herd }) {
  for (const [name, rows] of [['event', events], ['transaction', transactions]]) {
    if (rows.length > MAX_FILL_ROWS) {
      throw new Error(`The template holds at most ${MAX_FILL_ROWS} ${name} rows; ${rows.length} were requested.`)
    }
  }
  const files = unzipSync(templateBytes)
  const read = (path) => {
    if (!files[path]) throw new Error(`The template is missing ${path}.`)
    return strFromU8(files[path])
  }

  const workbookXml = read('xl/workbook.xml')
  const relsXml = read('xl/_rels/workbook.xml.rels')
  const eventsPath = sheetPath(workbookXml, relsXml, 'Events')
  const transactionsPath = sheetPath(workbookXml, relsXml, 'Transactions')
  const herdPath = sheetPath(workbookXml, relsXml, 'Herd')

  // --- Events ------------------------------------------------------------------------
  let eventsXml = fillRows(read(eventsPath), events, EVENT_COLUMNS, 'Events')
  // The tag dropdown points at the Herd tab; make it cover the new list length.
  const lastHerdRow = Math.max(herd.length + 1, 2)
  eventsXml = eventsXml.replace(/Herd!\$A\$2:\$A\$\d+/, `Herd!$A$2:$A$${lastHerdRow}`)
  files[eventsPath] = strToU8(eventsXml)

  // --- Transactions ------------------------------------------------------------------
  if (transactions.length) {
    files[transactionsPath] = strToU8(fillRows(read(transactionsPath), transactions, TRANSACTION_COLUMNS, 'Transactions'))
  }

  // --- Herd: keep the header row, rewrite the rest -----------------------------------
  let herdXml = read(herdPath)
  const herdRows = [...herd].sort(byTag).map((h, i) => {
    const r = i + 2
    const cells = [textCell(`A${r}`, h.tag_number, TEXT)]
    cells.push(textCell(`B${r}`, h.breed ?? ''))
    cells.push(textCell(`C${r}`, h.type ?? ''))
    cells.push(textCell(`D${r}`, h.location ?? ''))
    cells.push(textCell(`E${r}`, h.last_event_type ?? ''))
    if (h.last_event_date) cells.push(numberCell(`F${r}`, excelSerial(h.last_event_date), DATE))
    if (h.last_weight_lbs != null) cells.push(numberCell(`G${r}`, h.last_weight_lbs))
    if (h.last_weight_date) cells.push(numberCell(`H${r}`, excelSerial(h.last_weight_date), DATE))
    return `<row r="${r}">${cells.join('')}</row>`
  })
  herdXml = herdXml.replace(/(<row r="1">.*?<\/row>).*<\/sheetData>/s, (_, header) => `${header}${herdRows.join('')}</sheetData>`)
  herdXml = herdXml.replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="A1:${letter(HERD_COLUMN_COUNT - 1)}${lastHerdRow}" />`)
  files[herdPath] = strToU8(herdXml)

  return zipSync(files)
}
