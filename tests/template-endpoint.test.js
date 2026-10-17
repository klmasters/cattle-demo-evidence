// Run with: npm run test:upload
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleTemplate, templateWorkbook } from '../functions/_lib/template.js'
import { parseXlsx } from '../functions/_lib/parse.js'
import { validate } from '../functions/_lib/validate.js'

const TODAY = '2026-10-21'

const animal = (tag, o = {}) => ({
  tag_number: tag, type: 'Cow', gender: 'Female', birth_year: 2019, location: 'Home Pasture', last_event_type: 'worked',
  last_event_date: '2026-10-05', last_weight_lbs: '1210.00', last_weight_date: '2026-10-05', currently_pregnant: false, ...o,
})
const HERD = [
  animal('248'),
  animal('99', { location: 'North Pasture', currently_pregnant: true }),
  animal('301', { type: 'Bull', gender: 'Male', location: 'South Pasture' }),
]
// What the upload would load for these tags (the validator's second pass).
const herdMap = (rows = HERD) =>
  new Map(rows.map((a) => [a.tag_number, { status: 'active', lastEventDate: '2026-10-05', location: a.location, type: a.type, gender: a.gender, birth_year: a.birth_year, mother_tag_number: null, date_bought: null }]))

// A stand-in for the database: records the queries and returns the herd.
function fakeDb(rows = HERD) {
  const queries = []
  const client = { async query(sql) { queries.push(sql.replace(/\s+/g, ' ').trim()); return { rows } } }
  return { queries, withClient: (fn) => fn(client) }
}

function post(fields, method = 'POST') {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) form.append(k, item) // an array sends the field once per item
  return new Request('https://example.test/ranch-demo/api/template', method === 'POST' ? { method, body: form } : { method })
}
const GOOD = { event_type: 'worked', event_date: '2026-10-20', note: 'vaccinated (Pyramid 5)' }
const run = (request, deps = {}) => handleTemplate(request, { withClient: fakeDb().withClient, today: TODAY, ...deps })
const asSheets = async (res) => parseXlsx(await res.arrayBuffer())
const filled = (sheet) => sheet.rows.filter((r) => Object.values(r.values).some((v) => v != null))
const check = (sheets, herd = herdMap()) => validate(sheets, { today: TODAY, herd })
const messages = (list) => list.map((m) => `${m.sheet} ${m.row} ${m.column}`)

test('a working day: one row per animal, each with its own pasture, and it passes the validator', async () => {
  const res = await run(post(GOOD))
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /spreadsheetml/)
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="cattle_template_worked_2026-10-20.xlsx"')
  assert.equal(res.headers.get('x-row-count'), '3')
  const sheets = await asSheets(res)
  assert.equal(sheets.events.headers.includes('row_id'), false)
  const rows = filled(sheets.events)
  assert.deepEqual(rows.map((r) => r.values.tag_number), ['99', '248', '301']) // numeric order
  assert.deepEqual([rows[0].values.event_type, rows[0].values.location, rows[0].values.type, rows[0].values.gender, rows[0].values.notes],
    ['worked', 'North Pasture', 'Cow', 'Female', 'vaccinated (Pyramid 5)'])
  const result = check(sheets)
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.events.length, 3)
})

test('filters narrow the rows; several values and blanks work; a bad value is refused', async () => {
  const one = await run(post({ ...GOOD, location: 'north pasture', type: 'Cow' }))
  assert.equal(one.headers.get('x-row-count'), '1')
  assert.deepEqual(filled((await asSheets(one)).events).map((r) => r.values.tag_number), ['99'])
  assert.equal((await run(post({ ...GOOD, location: ['Home Pasture', 'south pasture'] }))).headers.get('x-row-count'), '2')
  assert.equal((await run(post({ ...GOOD, location: [''], gender: '' }))).headers.get('x-row-count'), '3')
  assert.equal((await run(post({ ...GOOD, gender: 'male' }))).headers.get('x-row-count'), '1')
  assert.equal((await run(post({ ...GOOD, location: ['Home Pasture', 'Mars'] }))).status, 400)
  assert.equal((await run(post({ ...GOOD, type: 'Steer' }))).status, 400)
  assert.equal((await run(post({ ...GOOD, location: 'Mars' }))).status, 400)
})

test('a pregnancy check: cows only, "preg check" in the notes, and the months are left for the visitor', async () => {
  const res = await run(post({ event_type: 'preg_check', event_date: '2026-10-05', note: 'Dr. Lee' }))
  assert.equal(res.headers.get('x-row-count'), '2')
  const sheets = await asSheets(res)
  const rows = filled(sheets.events)
  assert.deepEqual(rows.map((r) => r.values.tag_number), ['99', '248'])
  assert.equal(rows[0].values.event_type, 'worked')
  assert.equal(rows[0].values.notes, 'preg check; Dr. Lee')
  assert.equal(rows[0].values.estimated_months_pregnant, null)
  assert.deepEqual(messages(check(sheets).errors), ['Events 2 estimated_months_pregnant', 'Events 3 estimated_months_pregnant'])
  rows[0].values.estimated_months_pregnant = 4            // pregnant
  rows[1].values.notes = 'preg check - open'                 // open
  assert.equal(check(sheets).ok, true)
})

test('a move needs a destination; animals already there are left out; the old pasture goes in the notes', async () => {
  assert.equal((await run(post({ event_type: 'moved', event_date: '2026-06-01' }))).status, 400)
  assert.equal((await run(post({ event_type: 'moved', event_date: '2026-06-01', to: 'Mars' }))).status, 400)
  const res = await run(post({ event_type: 'moved', event_date: '2026-06-01', to: 'South Pasture', note: 'grazing rotation' }))
  assert.equal(res.headers.get('x-row-count'), '2')          // the bull is already in South Pasture
  const sheets = await asSheets(res)
  const rows = filled(sheets.events)
  assert.deepEqual(rows.map((r) => [r.values.tag_number, r.values.location, r.values.event_type]), [['99', 'South Pasture', 'moved'], ['248', 'South Pasture', 'moved']])
  assert.equal(rows[0].values.notes, 'moved from North Pasture to South Pasture — grazing rotation')
  const result = check(sheets)
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.deepEqual(result.warnings, [])
})

test('sold: a Transactions row is ready, and the file passes once weights and the price are added', async () => {
  const res = await run(post({ event_type: 'sold', event_date: '2026-10-20', type: 'Cow', location: 'Home Pasture' }))
  const sheets = await asSheets(res)
  const rows = filled(sheets.events)
  assert.deepEqual(rows.map((r) => r.values.tag_number), ['248'])
  const txn = filled(sheets.transactions)
  assert.equal(txn.length, 1)
  assert.deepEqual([txn[0].values.transaction_type, txn[0].values.tag_numbers], ['sale', null])
  assert.equal(check(sheets).ok, false)                       // no price yet
  rows[0].values.weight_lbs = 1200
  txn[0].values.price_per_cwt = 140
  const result = check(sheets)
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.transactions[0].total_amount, 1680)    // 1200 lb x $140 / 100
  assert.deepEqual(result.transactions[0].tag_numbers, ['248'])
})

test('deceased rows pass the validator as they are', async () => {
  const res = await run(post({ event_type: 'deceased', event_date: '2026-10-20' }))
  assert.equal(res.headers.get('x-row-count'), '3')
  const sheets = await asSheets(res)
  assert.equal(filled(sheets.transactions).length, 0)
  assert.equal(check(sheets).ok, true)
})

test('only a read of current_cattle is run', async () => {
  const db = fakeDb()
  await run(post(GOOD), { withClient: db.withClient })
  assert.equal(db.queries.length, 1)
  assert.match(db.queries[0], /^select .* from ranch_demo\.current_cattle$/)
})

test('a failed bot check gets 403 and never touches the database', async () => {
  const db = fakeDb()
  const res = await run(post(GOOD), { withClient: db.withClient, verifyHuman: async () => false })
  assert.equal(res.status, 403)
  assert.equal(db.queries.length, 0)
})

test('the bot check receives the token and address', async () => {
  let seen
  const form = new FormData()
  for (const [k, v] of Object.entries({ ...GOOD, 'cf-turnstile-response': 'tok' })) form.append(k, v)
  const request = new Request('https://example.test/ranch-demo/api/template', { method: 'POST', body: form, headers: { 'cf-connecting-ip': '1.2.3.4' } })
  const res = await run(request, { verifyHuman: async (token, ip) => { seen = [token, ip]; return true } })
  assert.equal(res.status, 200)
  assert.deepEqual(seen, ['tok', '1.2.3.4'])
})

test('bad input is refused with a clear message', async () => {
  const cases = [
    [{ ...GOOD, event_type: 'banana' }, /Pick an event type/],
    [{ ...GOOD, event_type: 'weight' }, /Pick an event type/],     // v7 name
    [{ ...GOOD, event_type: '' }, /Pick an event type/],
    [{ ...GOOD, event_date: '2026-02-30' }, /year-month-day/],
    [{ ...GOOD, event_date: '2026-10-23' }, /year-month-day/],     // later than tomorrow
    [{ ...GOOD, event_date: '1999-12-31' }, /year-month-day/],
    [{ ...GOOD, event_date: '10/20/2026' }, /year-month-day/],
    [{ ...GOOD, location: 'Ranch' }, /not one of the allowed/],     // v7 name
    [{ ...GOOD, note: 'x'.repeat(501) }, /at most 500/],
  ]
  for (const [fields, message] of cases) {
    const res = await run(post(fields))
    assert.equal(res.status, 400, JSON.stringify(fields))
    assert.match((await res.json()).message, message)
  }
})

test('no match gives a 404, GET a 405, and a database failure a generic 500', async () => {
  assert.equal((await run(post({ ...GOOD, location: 'South Pasture', type: 'Cow' }))).status, 404)
  assert.equal((await run(post(GOOD, 'GET'))).status, 405)
  const res = await run(post(GOOD), { withClient: async () => { throw new Error('password authentication failed') } })
  assert.equal(res.status, 500)
  assert.doesNotMatch(await res.text(), /password/)
})

// ---- births --------------------------------------------------------------------------

const BIRTH = { event_type: 'birth', event_date: '2026-03-04', note: 'easy pull' }

test('births: one row per pregnant cow, with her tag as the mother and her pasture for the calf', async () => {
  const res = await run(post(BIRTH))
  assert.equal(res.headers.get('x-row-count'), '1')
  const rows = filled((await asSheets(res)).events)
  assert.deepEqual(
    [rows[0].values.mother_tag_number, rows[0].values.event_type, rows[0].values.type, rows[0].values.location, rows[0].values.birth_year, rows[0].values.notes],
    ['99', 'birth', 'Calf', 'North Pasture', 2026, 'easy pull'],
  )
  assert.equal(rows[0].values.tag_number, null) // the calf's tag is for the visitor
})

test('births: the visitor adds the calf tag and gender and the file passes the validator', async () => {
  const sheets = await asSheets(await run(post(BIRTH)))
  const row = filled(sheets.events)[0]
  assert.equal(check(sheets).ok, false)              // tag and gender are still blank
  row.values.tag_number = '800'
  row.values.gender = 'Female'
  const result = check(sheets)
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.events[0].type, 'Calf')
})

test('births: "all cows" lists every cow; a location filter narrows; none pregnant is a 404 with advice', async () => {
  assert.equal((await run(post({ ...BIRTH, mothers: 'all' }))).headers.get('x-row-count'), '2') // the bull is not a mother
  assert.equal((await run(post({ ...BIRTH, mothers: 'all', location: 'Home Pasture' }))).headers.get('x-row-count'), '1')
  const none = await run(post(BIRTH), { withClient: fakeDb(HERD.map((a) => ({ ...a, currently_pregnant: false }))).withClient })
  assert.equal(none.status, 404)
  assert.match((await none.json()).message, /all cows/)
  assert.equal((await run(post({ ...BIRTH, mothers: 'some' }))).status, 400)
})

// ---- purchases -----------------------------------------------------------------------

const BUY = { event_type: 'purchase', event_date: '2026-09-08', count: '3', type: 'Cow', gender: 'Female', location: 'Home Pasture' }

test('purchases: the chosen number of rows and a Transactions row with just the date and type', async () => {
  const res = await run(post(BUY))
  assert.equal(res.headers.get('x-row-count'), '3')
  const sheets = await asSheets(res)
  const rows = filled(sheets.events)
  assert.equal(rows.length, 3)
  assert.deepEqual([rows[0].values.event_type, rows[0].values.type, rows[0].values.gender, rows[0].values.location], ['purchase', 'Cow', 'Female', 'Home Pasture'])
  const txn = filled(sheets.transactions)
  assert.deepEqual([txn.length, txn[0].values.transaction_type, txn[0].values.tag_numbers], [1, 'purchase', null])
})

test('purchases: the visitor adds tags and a price per head and the file passes the validator', async () => {
  const sheets = await asSheets(await run(post(BUY)))
  filled(sheets.events).forEach((r, i) => { r.values.tag_number = String(700 + i) })
  filled(sheets.transactions)[0].values.price_per_head = 4100
  const result = check(sheets, new Map())
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.transactions[0].total_amount, 12300)
  assert.equal(result.events[0].date_bought, '2026-09-08')
})

test('purchases: the count must be 1 to 500, and at most one choice per column', async () => {
  for (const count of ['0', '501', 'x', '2.5', '']) assert.equal((await run(post({ ...BUY, count }))).status, 400, count)
  assert.equal((await run(post({ ...BUY, location: ['Home Pasture', 'North Pasture'] }))).status, 400)
  assert.equal((await run(post({ event_type: 'purchase', event_date: '2026-09-08', count: '500' }))).status, 200)
})

// ---- the blank template ----------------------------------------------------------------

test('the blank template has an Events tab (no row_id), a Transactions tab and an ignored Instructions tab', async () => {
  const bytes = templateWorkbook({ kind: 'blank' })
  const sheets = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  assert.deepEqual(sheets.events.headers, ['tag_number', 'event_date', 'event_type', 'location', 'type', 'gender', 'birth_year', 'mother_tag_number', 'date_bought', 'weight_lbs', 'estimated_months_pregnant', 'notes'])
  assert.deepEqual(sheets.transactions.headers, ['transaction_date', 'transaction_type', 'tag_numbers', 'head_count', 'total_weight_lbs', 'price_per_cwt', 'price_per_head', 'total_amount', 'notes'])
  assert.equal(sheets.events.rows.length, 0)
})
