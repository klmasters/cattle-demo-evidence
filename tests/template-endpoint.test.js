// Run with: npm run test:upload
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleTemplate } from '../functions/_lib/template.js'
import { parseXlsx } from '../functions/_lib/parse.js'
import { validate } from '../functions/_lib/validate.js'

const blank = new Uint8Array(readFileSync(new URL('../static/cattle_upload_template.xlsx', import.meta.url)))
const TODAY = '2026-10-21'

const animal = (tag, o = {}) => ({
  tag_number: tag, breed: 'Black Angus', type: 'Cow', location: 'Ranch', last_event_type: 'weight',
  last_event_date: '2026-03-01', last_weight_lbs: '90.50', last_weight_date: '2026-03-01', ...o,
})
const HERD = [animal('248'), animal('99', { location: 'Eureka', breed: 'Red Angus' }), animal('301', { type: 'Bull' })]

// A stand-in for the database: records the queries and returns the herd.
function fakeDb(rows = HERD, pregnant = ['99']) {
  const queries = []
  const client = {
    async query(sql) {
      queries.push(sql.replace(/\s+/g, ' ').trim())
      return { rows: /with ev as/.test(sql) ? pregnant.map((tag_number) => ({ tag_number })) : rows }
    },
  }
  return { queries, withClient: (fn) => fn(client) }
}

function post(fields, method = 'POST') {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) form.append(k, item) // an array sends the field once per item
  return new Request('https://example.test/ranch-demo/api/template', method === 'POST' ? { method, body: form } : { method })
}
const GOOD = { event_type: 'vaccination', event_date: '2026-10-20', note: '7-way' }
const run = (request, deps = {}) => handleTemplate(request, { withClient: fakeDb().withClient, loadTemplate: async () => blank, today: TODAY, ...deps })
const asSheets = async (res) => parseXlsx(await res.arrayBuffer())

test('returns a filled xlsx that passes the real validator', async () => {
  const res = await run(post(GOOD))
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /spreadsheetml/)
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="cattle_template_vaccination_2026-10-20.xlsx"')
  assert.equal(res.headers.get('x-row-count'), '3')
  const sheets = await asSheets(res)
  const filled = sheets.events.rows.filter((r) => r.values.tag_number)
  assert.deepEqual(filled.map((r) => r.values.tag_number), ['99', '248', '301']) // numeric order
  assert.equal(filled[0].values.location, 'Eureka') // each animal's own location and breed
  assert.equal(filled[0].values.breed, 'Red Angus')
  assert.equal(filled[0].values.notes, '7-way')
  const result = validate(sheets, { today: TODAY })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.events.length, 3)
})

test('filters narrow the Events rows but not the Herd tab', async () => {
  const res = await run(post({ ...GOOD, location: 'ranch', type: 'Cow' }))
  assert.equal(res.headers.get('x-row-count'), '1')
  const sheets = await asSheets(res)
  assert.deepEqual(sheets.events.rows.filter((r) => r.values.tag_number).map((r) => r.values.tag_number), ['248'])
})

test('a filter can name several values, and a blank value means any', async () => {
  const two = await run(post({ ...GOOD, location: ['Ranch', 'eureka'] }))
  assert.equal(two.headers.get('x-row-count'), '3')
  const typed = await run(post({ ...GOOD, location: ['Ranch', 'Eureka'], type: ['Bull', 'Calf'] }))
  assert.equal(typed.headers.get('x-row-count'), '1') // only the bull
  const blank = await run(post({ ...GOOD, location: [''], breed: '' }))
  assert.equal(blank.headers.get('x-row-count'), '3')
  const some = await run(post({ ...GOOD, breed: ['Red Angus', 'Sim Angus'] }))
  assert.equal(some.headers.get('x-row-count'), '1')
})

test('one bad value among several is refused', async () => {
  const res = await run(post({ ...GOOD, location: ['Ranch', 'Mars'] }))
  assert.equal(res.status, 400)
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
    [{ ...GOOD, event_type: '' }, /Pick an event type/],
    [{ ...GOOD, event_date: '2026-02-30' }, /year-month-day/],
    [{ ...GOOD, event_date: '2026-10-23' }, /year-month-day/], // later than tomorrow
    [{ ...GOOD, event_date: '1999-12-31' }, /year-month-day/],
    [{ ...GOOD, event_date: '10/20/2026' }, /year-month-day/],
    [{ ...GOOD, location: 'Mars' }, /not one of the allowed/],
    [{ ...GOOD, breed: 'Hereford' }, /not one of the allowed/],
    [{ ...GOOD, note: 'x'.repeat(501) }, /at most 500/],
  ]
  for (const [fields, message] of cases) {
    const res = await run(post(fields))
    assert.equal(res.status, 400, JSON.stringify(fields))
    assert.match((await res.json()).message, message)
  }
})

// ---- births --------------------------------------------------------------------------

const BIRTH = { event_type: 'birth', event_date: '2026-03-04', note: 'easy pull' }
const eventRows = (sheets) => sheets.events.rows.filter((r) => Object.values(r.values).some((v) => v != null))

test('births: one row per pregnant cow, with her tag, breed and location copied to the calf', async () => {
  const res = await run(post(BIRTH))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-row-count'), '1')
  const rows = eventRows(await asSheets(res))
  assert.equal(rows.length, 1)
  assert.deepEqual(
    [rows[0].values.mother_tag_number, rows[0].values.event_type, rows[0].values.type, rows[0].values.location, rows[0].values.breed, rows[0].values.birth_year, rows[0].values.notes],
    ['99', 'birth', 'Calf', 'Eureka', 'Red Angus', 2026, 'easy pull'],
  )
  assert.equal(rows[0].values.tag_number, null) // the calf's tag is for the visitor
})

test('births: the visitor adds the calf tags and the file passes the validator', async () => {
  const sheets = await asSheets(await run(post(BIRTH, 'POST'), { withClient: fakeDb(HERD, ['99', '248']).withClient }))
  eventRows(sheets).forEach((r, i) => { r.values.tag_number = `C${i + 1}` })
  const result = validate(sheets, { today: TODAY })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.deepEqual(result.events.map((e) => e.mother_tag_number), ['99', '248'])
  assert.deepEqual(result.warnings.filter((w) => w.column === 'mother_tag_number'), []) // no "birth without a mother" warning
})

test('births: left blank, the only problem is the missing calf tags', async () => {
  const sheets = await asSheets(await run(post(BIRTH)))
  const result = validate(sheets, { today: TODAY })
  assert.deepEqual([...new Set(result.errors.map((e) => e.column))], ['tag_number'])
})

test('births: "all cows" lists every cow, and filters narrow the mothers', async () => {
  const all = await run(post({ ...BIRTH, mothers: 'all' }))
  assert.deepEqual(eventRows(await asSheets(all)).map((r) => r.values.mother_tag_number), ['99', '248']) // the bull is not a mother
  const eureka = await run(post({ ...BIRTH, mothers: 'all', location: 'Eureka' }))
  assert.deepEqual(eventRows(await asSheets(eureka)).map((r) => r.values.mother_tag_number), ['99'])
  const pregnantRanch = await run(post({ ...BIRTH, location: 'Ranch' })) // 99 is pregnant but at Eureka
  assert.equal(pregnantRanch.status, 404)
})

test('births: nobody pregnant points to the "all cows" choice, and a bad choice is refused', async () => {
  const none = await run(post(BIRTH), { withClient: fakeDb(HERD, []).withClient })
  assert.equal(none.status, 404)
  assert.match((await none.json()).message, /all cows/)
  assert.equal((await run(post({ ...BIRTH, mothers: 'some' }))).status, 400)
})

test('births: pregnant-cow lookup only runs for births from pregnant cows', async () => {
  const db = fakeDb()
  await run(post(BIRTH), { withClient: db.withClient })
  assert.equal(db.queries.length, 2)
  const all = fakeDb()
  await run(post({ ...BIRTH, mothers: 'all' }), { withClient: all.withClient })
  assert.equal(all.queries.length, 1)
})

// ---- purchases -----------------------------------------------------------------------

const BUY = { event_type: 'purchase', event_date: '2026-10-20', count: '3', breed: 'Sim Angus', type: 'Cow', location: 'Eureka', note: 'sale barn' }

test('purchases: the chosen number of rows, with the breed, type and location filled in', async () => {
  const res = await run(post(BUY))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-row-count'), '3')
  const sheets = await asSheets(res)
  const rows = eventRows(sheets)
  assert.equal(rows.length, 3)
  assert.deepEqual(
    [rows[0].values.event_type, rows[0].values.breed, rows[0].values.type, rows[0].values.location, rows[0].values.notes],
    ['purchase', 'Sim Angus', 'Cow', 'Eureka', 'sale barn'],
  )
  assert.equal(rows[0].values.tag_number, null)
})

test('purchases: a Transactions row is ready, and with tags and a price the file passes the validator', async () => {
  const sheets = await asSheets(await run(post(BUY)))
  const txns = sheets.transactions.rows.filter((r) => Object.values(r.values).some((v) => v != null))
  assert.equal(txns.length, 1)
  assert.equal(txns[0].values.transaction_type, 'purchase')
  assert.equal(txns[0].values.tag_numbers, null)
  // The visitor types the tags on Events and the price per head on Transactions, and nothing else.
  eventRows(sheets).forEach((r, i) => { r.values.tag_number = `B${i + 1}` })
  txns[0].values.price_per_head = 1800
  const result = validate(sheets, { today: TODAY })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.deepEqual(result.transactions[0].tag_numbers, ['B1', 'B2', 'B3'])
  assert.equal(result.transactions[0].head_count, 3)
  assert.equal(result.transactions[0].total_amount, 5400)
})

test('purchases: breed, type and location can be left blank, and then the visitor must fill them in', async () => {
  const res = await run(post({ event_type: 'purchase', event_date: '2026-10-20', count: '2' }))
  assert.equal(res.status, 200)
  const sheets = await asSheets(res)
  eventRows(sheets).forEach((r, i) => { r.values.tag_number = `B${i + 1}` })
  const result = validate(sheets, { today: TODAY })
  // The price is also still blank, so the Transactions row asks for it too.
  assert.deepEqual([...new Set(result.errors.map((e) => e.column))].sort(), ['breed', 'location', 'price_per_head', 'type'])
})

test('purchases: the count must be a whole number from 1 to 500, with at most one breed, type and location', async () => {
  for (const count of ['0', '501', 'abc', '2.5', '']) {
    assert.equal((await run(post({ ...BUY, count }))).status, 400, `count ${count}`)
  }
  assert.equal((await run(post({ ...BUY, count: '500' }))).status, 200)
  assert.equal((await run(post({ ...BUY, breed: ['Sim Angus', 'Red Angus'] }))).status, 400)
  assert.equal((await run(post({ ...BUY, location: ['Ranch', 'Eureka'] }))).status, 400)
})

test('tomorrow is allowed, like the upload', async () => {
  assert.equal((await run(post({ ...GOOD, event_date: '2026-10-22' }))).status, 200)
})

test('GET is refused', async () => {
  assert.equal((await run(post({}, 'GET'))).status, 405)
})

test('no matching animals gives 404', async () => {
  const res = await run(post({ ...GOOD, breed: 'Sim Angus' }))
  assert.equal(res.status, 404)
})

test('more animals than a file holds asks for a filter', async () => {
  const many = Array.from({ length: 501 }, (_, i) => animal(String(1000 + i)))
  const res = await run(post(GOOD), { withClient: fakeDb(many).withClient })
  assert.equal(res.status, 400)
  assert.match((await res.json()).message, /Narrow the list/)
})

test('a database or template failure gives a generic 500', async () => {
  const quiet = console.error
  console.error = () => {}
  try {
    const broken = await run(post(GOOD), { withClient: async () => { throw new Error('password authentication failed for user x') } })
    assert.equal(broken.status, 500)
    assert.doesNotMatch(JSON.stringify(await broken.json()), /password/)
    const missing = await run(post(GOOD), { loadTemplate: async () => { throw new Error('blank template: status 404') } })
    assert.equal(missing.status, 500)
  } finally {
    console.error = quiet
  }
})
