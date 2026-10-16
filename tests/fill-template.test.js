// Run with: npm run test:upload
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { fillTemplate, excelSerial, MAX_FILL_ROWS } from '../functions/_lib/fill-template.js'
import { parseXlsx } from '../functions/_lib/parse.js'
import { validate } from '../functions/_lib/validate.js'

const template = new Uint8Array(readFileSync(new URL('../static/cattle_upload_template.xlsx', import.meta.url)))

const herd = [
  { tag_number: '248', breed: 'Black Angus', type: 'Cow', location: 'Ranch', last_event_type: 'vaccination', last_event_date: '2026-05-28', last_weight_lbs: null, last_weight_date: null },
  { tag_number: '99', breed: 'Red Angus', type: 'Cow', location: 'Eureka', last_event_type: 'weight', last_event_date: '2026-03-01', last_weight_lbs: 1210, last_weight_date: '2026-03-01' },
  { tag_number: 'A7-X', breed: 'Sim Angus', type: 'Bull', location: 'Ranch', last_event_type: 'purchase', last_event_date: '2025-11-02', last_weight_lbs: null, last_weight_date: null },
]
const events = herd.map((h) => ({
  tag_number: h.tag_number,
  event_date: '2026-10-20',
  event_type: 'vaccination',
  location: h.location,
  breed: h.breed,
  type: h.type,
  notes: '7-way "booster"',
}))

test('excelSerial matches Excel dates', () => {
  assert.equal(excelSerial('2000-01-01'), 36526)
  assert.equal(excelSerial('2026-05-28'), 46170)
})

test('filled rows come back through the real parser and validator', async () => {
  const bytes = fillTemplate(template, { events, herd })
  const sheets = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const filled = sheets.events.rows.filter((r) => r.values.tag_number)
  assert.equal(filled.length, 3)
  assert.equal(filled[0].values.notes, '7-way "booster"') // quotes survive

  const result = validate(sheets, { today: '2026-10-21' })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.events.length, 3)
  assert.equal(result.events[0].event_date, '2026-10-20')
})

test('characters that are special in XML survive the round trip', async () => {
  const odd = [{ ...events[0], tag_number: 'A7 & <b>' }]
  const bytes = fillTemplate(template, { events: odd, herd: [] })
  const sheets = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  assert.equal(sheets.events.rows[0].values.tag_number, 'A7 & <b>')
})

test('the Herd tab is rewritten and the tag dropdown covers it', () => {
  const files = unzipSync(fillTemplate(template, { events: [], herd }))
  const eventsXml = strFromU8(files['xl/worksheets/sheet1.xml'])
  const herdXml = strFromU8(files['xl/worksheets/sheet3.xml'])
  assert.match(eventsXml, /Herd!\$A\$2:\$A\$4/)
  assert.match(herdXml, /<dimension ref="A1:H4"/)
  assert.equal((herdXml.match(/<row /g) || []).length, 4) // header + 3 animals
  assert.ok(herdXml.indexOf('>99<') < herdXml.indexOf('>248<')) // numeric order
})

test('dropdowns, header notes and the Transactions tab survive', () => {
  const files = unzipSync(fillTemplate(template, { events, herd }))
  const eventsXml = strFromU8(files['xl/worksheets/sheet1.xml'])
  assert.equal((eventsXml.match(/<dataValidation /g) || []).length, 10)
  assert.ok(files['xl/comments/comment1.xml'])
  const before = unzipSync(template)
  assert.equal(strFromU8(files['xl/worksheets/sheet2.xml']), strFromU8(before['xl/worksheets/sheet2.xml']))
})

test('a partly filled Transactions row keeps the template formatting on its empty cells', () => {
  const files = unzipSync(fillTemplate(template, { events: [], herd, transactions: [{ transaction_date: '2026-10-20', transaction_type: 'purchase' }] }))
  const row2 = /<row r="2">.*?<\/row>/.exec(strFromU8(files['xl/worksheets/sheet2.xml']))[0]
  assert.match(row2, /<c r="A2" s="4" t="n"><v>46315<\/v>/) // date, formatted as a date
  assert.match(row2, /<c r="B2" t="inlineStr"><is><t>purchase<\/t>/)
  assert.match(row2, /<c r="C2" s="3" t="n" \/>/) // empty tag list, text format kept
  assert.match(row2, /<c r="E2" s="5" t="n" \/>/) // empty price, money format kept
})

test('every Events column can be filled', async () => {
  const full = [{
    tag_number: 'B1', event_date: '2026-03-04', event_type: 'birth', location: 'Ranch', breed: 'Red Angus', type: 'Calf',
    weight_lbs: 82.5, notes: 'n', mother_tag_number: '248', previous_tag_number: 'OLD-1', birth_year: 2026,
    estimated_preg_date: '2025-06-01', estimated_months_pregnant: 5, estimated_due_month: '2026-03-01',
  }]
  const bytes = fillTemplate(template, { events: full, herd })
  const sheets = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const v = sheets.events.rows[0].values
  assert.deepEqual(
    [v.tag_number, v.type, v.weight_lbs, v.mother_tag_number, v.previous_tag_number, v.birth_year, v.estimated_months_pregnant],
    ['B1', 'Calf', 82.5, '248', 'OLD-1', 2026, 5],
  )
  const result = validate(sheets, { today: '2026-10-21' })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.events[0].estimated_due_month, '2026-03-01')
})

test('too many rows are refused', () => {
  const many = Array.from({ length: MAX_FILL_ROWS + 1 }, (_, i) => ({ ...events[0], tag_number: String(i) }))
  assert.throws(() => fillTemplate(template, { events: many, herd }), /at most 500/)
})

// Writes the file so it can be opened in Excel or Numbers by hand:
//   WRITE_SAMPLE=1 node --test tests/fill-template.test.js
if (process.env.WRITE_SAMPLE) {
  test('write a sample file', () => {
    writeFileSync(process.env.WRITE_SAMPLE_PATH || 'sample-filled-template.xlsx', fillTemplate(template, { events, herd }))
  })
}
