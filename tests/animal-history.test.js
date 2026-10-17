// Run with: npm run test:upload
import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { handleAnimalHistory } from '../functions/_lib/animal-history.js'
import { parseXlsx } from '../functions/_lib/parse.js'

const ROWS = [
  { row_id: 'r1', tag_number: '248', event_date: '2024-04-02', event_type: 'birth', location: 'Home Pasture', type: 'Calf', gender: 'Male', birth_year: 2024, mother_tag_number: '135', date_bought: null, weight_lbs: 80, estimated_months_pregnant: null, notes: null },
  { row_id: 'r2', tag_number: '248', event_date: '2024-10-25', event_type: 'sold', location: 'Home Pasture', type: 'Calf', gender: 'Male', birth_year: 2024, mother_tag_number: '135', date_bought: null, weight_lbs: 538, estimated_months_pregnant: null, notes: 'a & b "quoted" <x>' },
]
const ACTIVE = [ROWS[0], { ...ROWS[1], event_type: 'worked' }]

function fakeDb(rows) {
  const calls = []
  return { calls, withClient: (fn) => fn({ async query(sql, params) { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows } } }) }
}
const post = (fields) => {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new Request('https://example.test/ranch-demo/api/animal-history', { method: 'POST', body: form })
}

test('returns an xlsx whose Events tab holds the history, row_id first', async () => {
  const db = fakeDb(ACTIVE)
  const res = await handleAnimalHistory(post({ tag: '248' }), db)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition'), /animal_248_history\.xlsx/)
  assert.equal(res.headers.get('x-row-count'), '2')
  const { events } = await parseXlsx(await res.arrayBuffer())
  assert.ok(events, 'has an Events tab')
  assert.equal(events.headers[0], 'row_id')
  assert.equal(events.rows.length, 2)
  const first = events.rows[0].values
  assert.equal(first.row_id, 'r1')
  assert.equal(first.tag_number, '248')
  assert.equal(String(first.event_date instanceof Date ? first.event_date.toISOString().slice(0, 10) : first.event_date), '2024-04-02')
  assert.equal(first.weight_lbs, 80)
  assert.equal(first.notes, null)
  assert.deepEqual(db.calls[0].params, ['248'])
  assert.match(db.calls[0].sql, /voided is not true/)
})

test('special characters in notes survive, and dropdowns are written for the list columns', async () => {
  const res = await handleAnimalHistory(post({ tag: '248' }), fakeDb(ROWS))
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
  const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml'])
  assert.match(sheet1, /a &amp; b &quot;quoted&quot; &lt;x&gt;/)
  assert.match(sheet1, /<formula1>"worked,moved,birth,purchase,sold,deceased"<\/formula1>/)
  assert.match(sheet1, /Home Pasture,North Pasture,South Pasture/)
})

test('a sold or deceased animal gets a read-only note in the Instructions tab', async () => {
  const res = await handleAnimalHistory(post({ tag: '248' }), fakeDb(ROWS))
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
  assert.match(strFromU8(files['xl/worksheets/sheet3.xml']), /no new events can be added/)
  const active = await handleAnimalHistory(post({ tag: '248' }), fakeDb(ACTIVE))
  const text = strFromU8(unzipSync(new Uint8Array(await active.arrayBuffer()))['xl/worksheets/sheet3.xml'])
  assert.match(text, /Leave row_id blank/)
})

test('unknown tag is a 404, a missing tag a 400, and GET is refused', async () => {
  assert.equal((await handleAnimalHistory(post({ tag: 'nope' }), fakeDb([]))).status, 404)
  assert.equal((await handleAnimalHistory(post({ tag: '  ' }), fakeDb(ROWS))).status, 400)
  assert.equal((await handleAnimalHistory(new Request('https://example.test/x'), fakeDb(ROWS))).status, 405)
})

test('the bot check is enforced before the database is touched', async () => {
  const db = fakeDb(ROWS)
  const res = await handleAnimalHistory(post({ tag: '248' }), { ...db, verifyHuman: async () => false })
  assert.equal(res.status, 403)
  assert.equal(db.calls.length, 0)
})

test('a database failure gives a generic 500', async () => {
  const res = await handleAnimalHistory(post({ tag: '248' }), { withClient: async () => { throw new Error('secret detail') } })
  assert.equal(res.status, 500)
  assert.doesNotMatch(await res.text(), /secret detail/)
})
