// Fills the blank upload template with rows and returns a new .xlsx.
//
// The template (static/cattle_upload_template.xlsx) is a zip of XML files. Rather than
// rebuild the workbook, which would lose its dropdowns and header notes, this unzips it,
// writes cells into the Events and Herd sheets, and zips it again.
//   Events: one pre-filled row per animal (tag, date, event type, location, breed, type, notes)
//   Herd:   the reference tab, rewritten from the live herd, and the Events tag dropdown
//           is pointed at the new length of that list
// Everything else in the file (Transactions tab, validation, header notes) is untouched.

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

export const MAX_FILL_ROWS = 500 // the template's validation covers Events rows 2..501

// Style numbers in the template's styles.xml: 3 = text, 4 = yyyy-mm-dd date.
const TEXT_STYLE = 3
const DATE_STYLE = 4

const HERD_COLUMNS = ['tag_number', 'breed', 'type', 'location', 'last_event_type', 'last_event_date', 'last_weight_lbs', 'last_weight_date']
const COLUMN_LETTERS = 'ABCDEFGH'

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
// events: [{ tag_number, event_date: 'YYYY-MM-DD', event_type, location, breed, type, notes }]
// herd:   [{ tag_number, breed, type, location, last_event_type, last_event_date, last_weight_lbs, last_weight_date }]
export function fillTemplate(templateBytes, { events, herd }) {
  if (events.length > MAX_FILL_ROWS) {
    throw new Error(`The template holds at most ${MAX_FILL_ROWS} event rows; ${events.length} were requested.`)
  }
  const files = unzipSync(templateBytes)
  const read = (path) => {
    if (!files[path]) throw new Error(`The template is missing ${path}.`)
    return strFromU8(files[path])
  }

  const workbookXml = read('xl/workbook.xml')
  const relsXml = read('xl/_rels/workbook.xml.rels')
  const eventsPath = sheetPath(workbookXml, relsXml, 'Events')
  const herdPath = sheetPath(workbookXml, relsXml, 'Herd')

  // --- Events: replace the empty styled row r with a filled one -------------------
  let eventsXml = read(eventsPath)
  events.forEach((e, i) => {
    const r = i + 2
    const cells = [
      textCell(`A${r}`, e.tag_number, TEXT_STYLE),
      numberCell(`B${r}`, excelSerial(e.event_date), DATE_STYLE),
      textCell(`C${r}`, e.event_type),
      textCell(`D${r}`, e.location),
      textCell(`E${r}`, e.breed),
      textCell(`F${r}`, e.type),
    ]
    if (e.notes) cells.push(textCell(`H${r}`, e.notes))
    // Weight (G) stays blank. The template also formats I, J, L and N, so keep those empty
    // styled cells or the formatting would be lost on filled rows.
    const kept = ['I', 'J', 'L', 'N'].map((c) => {
      const style = c === 'I' || c === 'J' ? TEXT_STYLE : DATE_STYLE
      return `<c r="${c}${r}" s="${style}" t="n" />`
    })
    const row = `<row r="${r}">${cells.join('')}${kept.join('')}</row>`
    const pattern = new RegExp(`<row r="${r}">.*?</row>`)
    if (!pattern.test(eventsXml)) throw new Error(`The template has no row ${r} on the Events tab.`)
    eventsXml = eventsXml.replace(pattern, () => row)
  })
  // The tag dropdown points at the Herd tab; make it cover the new list length.
  const lastHerdRow = Math.max(herd.length + 1, 2)
  eventsXml = eventsXml.replace(/Herd!\$A\$2:\$A\$\d+/, `Herd!$A$2:$A$${lastHerdRow}`)
  files[eventsPath] = strToU8(eventsXml)

  // --- Herd: keep the header row, rewrite the rest ---------------------------------
  let herdXml = read(herdPath)
  const sorted = [...herd].sort(byTag)
  const herdRows = sorted.map((h, i) => {
    const r = i + 2
    const cells = [textCell(`A${r}`, h.tag_number, TEXT_STYLE)]
    cells.push(textCell(`B${r}`, h.breed ?? ''))
    cells.push(textCell(`C${r}`, h.type ?? ''))
    cells.push(textCell(`D${r}`, h.location ?? ''))
    cells.push(textCell(`E${r}`, h.last_event_type ?? ''))
    if (h.last_event_date) cells.push(numberCell(`F${r}`, excelSerial(h.last_event_date), DATE_STYLE))
    if (h.last_weight_lbs != null) cells.push(numberCell(`G${r}`, h.last_weight_lbs))
    if (h.last_weight_date) cells.push(numberCell(`H${r}`, excelSerial(h.last_weight_date), DATE_STYLE))
    return `<row r="${r}">${cells.join('')}</row>`
  })
  herdXml = herdXml.replace(/(<row r="1">.*?<\/row>).*<\/sheetData>/s, (_, header) => `${header}${herdRows.join('')}</sheetData>`)
  herdXml = herdXml.replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="A1:${COLUMN_LETTERS[HERD_COLUMNS.length - 1]}${lastHerdRow}" />`)
  files[herdPath] = strToU8(herdXml)

  return zipSync(files)
}
