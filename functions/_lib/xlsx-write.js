// Builds an .xlsx from scratch (a zip of XML files, written with fflate). Used for the
// animal-history download. Each sheet is a header row plus data rows, with optional
// dropdown lists on columns. Excel, Numbers and Google Sheets all open the result.
//
//   buildWorkbook([{ name, columns: [{ key, header?, kind, width?, list?, readonly? }], rows: [{ key: value }] }])
//
// kind: 'text' (kept as typed, so 0012 stays 0012), 'str', 'number' or 'date' (value 'YYYY-MM-DD').
// A column's format also applies to the empty cells below the data, so rows a visitor adds keep it.

import { zipSync, strToU8 } from 'fflate'

export const MAX_ROWS = 501 // dropdowns and formats cover rows 2..501, the same 500 rows the upload accepts

// Style numbers in styles.xml below.
const HEADER = 1
const TEXT = 2
const DATE = 3
const SHADED_TEXT = 4

const escapeXml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const letter = (index) => String.fromCharCode(65 + index) // the sheets here stay under 26 columns

// '2026-05-28' -> 46170 (days since 1899-12-30, how Excel stores dates)
export function excelSerial(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate))
  if (!match) throw new Error(`Not a date: ${isoDate}`)
  return Date.UTC(+match[1], +match[2] - 1, +match[3]) / 86400000 + 25569
}

const isBlank = (v) => v === undefined || v === null || v === ''

function columnStyle(col) {
  if (col.kind === 'date') return DATE
  if (col.kind === 'text') return col.readonly ? SHADED_TEXT : TEXT
  return undefined
}

function cellXml(ref, col, value) {
  const style = columnStyle(col)
  const s = style === undefined ? '' : ` s="${style}"`
  if (col.kind === 'date') return `<c r="${ref}"${s}><v>${excelSerial(value)}</v></c>`
  if (col.kind === 'number') return `<c r="${ref}"${s}><v>${Number(value)}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function sheetXml({ columns, rows }) {
  if (rows.length > MAX_ROWS - 1) throw new Error(`A sheet holds at most ${MAX_ROWS - 1} rows.`)
  const header = columns
    .map((col, i) => `<c r="${letter(i)}1" s="${HEADER}" t="inlineStr"><is><t>${escapeXml(col.header ?? col.key)}</t></is></c>`)
    .join('')
  const body = rows.map((values, r) => {
    const cells = columns.flatMap((col, i) => (isBlank(values[col.key]) ? [] : [cellXml(`${letter(i)}${r + 2}`, col, values[col.key])]))
    return `<row r="${r + 2}">${cells.join('')}</row>`
  })

  const cols = columns
    .map((col, i) => {
      const style = columnStyle(col)
      const s = style === undefined ? '' : ` style="${style === SHADED_TEXT ? TEXT : style}"` // empty cells below are not shaded
      return `<col min="${i + 1}" max="${i + 1}" width="${col.width ?? 14}" customWidth="1"${s}/>`
    })
    .join('')

  const lists = columns.flatMap((col, i) =>
    col.list
      ? [`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" errorTitle="Not on the list" error="Pick a value from the list." sqref="${letter(i)}2:${letter(i)}${MAX_ROWS}"><formula1>"${escapeXml(col.list.join(','))}"</formula1></dataValidation>`]
      : [],
  )
  const validations = lists.length ? `<dataValidations count="${lists.length}">${lists.join('')}</dataValidations>` : ''

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body.join('')}</sheetData>` +
    validations +
    '</worksheet>'
  )
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
  '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF3D6642"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

export function buildWorkbook(sheets) {
  const n = sheets.length
  const files = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
    'xl/styles.xml': STYLES,
  }
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet)
  })
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])))
}
