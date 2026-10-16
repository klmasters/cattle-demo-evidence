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
function fakeDb(rows = HERD) {
  const queries = []
  return { queries, withClient: (fn) => fn({ async query(sql) { queries.push(sql.replace(/\s+/g, ' ').trim()); return { rows } } }) }
}

function post(fields, method = 'POST') {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
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
  assert.equal(res.headers.get('x-animal-count'), '3')
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
  assert.equal(res.headers.get('x-animal-count'), '1')
  const sheets = await asSheets(res)
  assert.deepEqual(sheets.events.rows.filter((r) => r.values.tag_number).map((r) => r.values.tag_number), ['248'])
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
    [{ ...GOOD, event_type: 'birth' }, /Pick an event type/],
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
