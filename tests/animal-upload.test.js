// Run with: npm run test:upload
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleUpload } from '../functions/_lib/handle.js'
import { separateSavedRows } from '../functions/_lib/animal-upload.js'
import { buildWorkbook } from '../functions/_lib/xlsx-write.js'
import { EVENT_COLUMNS, TRANSACTION_COLUMNS } from '../functions/_lib/schema-v8.js'

const BATCH_ID = '1a2b3c4d-0000-4000-8000-000000000000'

// What the database holds for tag 248 (a cow, active).
const SAVED = [
  { row_id: 'r1', tag_number: '248', event_date: '2026-05-14', event_type: 'worked', location: 'Home Pasture', type: 'Cow', gender: 'Female', birth_year: 2019, mother_tag_number: null, date_bought: null, weight_lbs: 1013, estimated_months_pregnant: null, notes: 'weighed' },
  { row_id: 'r2', tag_number: '248', event_date: '2026-06-11', event_type: 'moved', location: 'South Pasture', type: 'Cow', gender: 'Female', birth_year: 2019, mother_tag_number: null, date_bought: null, weight_lbs: null, estimated_months_pregnant: null, notes: 'moved from Home Pasture to South Pasture' },
]
const HERD_ROW = { tag_number: '248', event_type: 'moved', event_date: '2026-06-11', location: 'South Pasture', type: 'Cow', gender: 'Female', birth_year: 2019, mother_tag_number: null, date_bought: null }

function fakeDb({ saved = SAVED, herdRows = [HERD_ROW], duplicate = false } = {}) {
  const queries = []
  const client = {
    async query(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      if (/row_id = any/.test(sql)) return { rows: saved.filter((r) => params[0].includes(r.row_id)) }
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] }
      if (/distinct on/.test(sql)) return { rows: herdRows }
      if (/insert into ranch_demo.upload_batches/.test(sql)) return { rows: duplicate ? [] : [{ batch_id: BATCH_ID }] }
      return { rows: [] }
    },
  }
  return { queries, deps: { withClient: (fn) => fn(client) } }
}

// A history download as the visitor sends it back: the saved rows, plus whatever they added.
const asFile = (events, transactions = []) =>
  new File([buildWorkbook([
    { name: 'Events', columns: EVENT_COLUMNS, rows: events },
    { name: 'Transactions', columns: TRANSACTION_COLUMNS, rows: transactions },
  ])], 'animal_248_history.xlsx')
const post = (file, fields = { animal_tag: '248' }) => {
  const form = new FormData()
  form.append('file', file)
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new Request('https://example.test/ranch-demo/api/upload', { method: 'POST', body: form })
}
const run = async (request, deps) => {
  const res = await handleUpload(request, deps)
  return { status: res.status, body: await res.json() }
}
const NEW = { tag_number: '248', event_date: '2026-10-10', event_type: 'worked', notes: 'vaccinated (Pyramid 5); weighed', weight_lbs: 1040 }
const inserted = (db) => db.queries.find((q) => q.sql.startsWith('insert into ranch_demo.cattle_events'))

test('the saved rows are skipped and only the new row is saved, filled in from the animal record', async () => {
  const db = fakeDb()
  const { status, body } = await run(post(asFile([...SAVED, NEW])), db.deps)
  assert.equal(status, 200, JSON.stringify(body))
  assert.equal(body.counts.events, 1)
  assert.match(body.infos[0].message, /2 saved events in the file were skipped/)
  assert.equal(body.warningCount, 0)
  const insert = inserted(db)
  assert.equal(insert.params.length, 13)                       // batch_id + 12 columns, one row
  assert.equal(insert.params[0], BATCH_ID)
  assert.ok(insert.params.includes('2026-10-10'))
  assert.ok(insert.params.includes('Home Pasture') === false)  // location is where it was last: South Pasture
  assert.ok(insert.params.includes('South Pasture'))
  assert.ok(insert.params.includes('Female'))
  const batch = db.queries.find((q) => /insert into ranch_demo.upload_batches/.test(q.sql))
  assert.equal(batch.params[2], 1)                             // row_count counts the new row only
})

test('a change to a saved row is ignored without a warning, and the rest still saves', async () => {
  const db = fakeDb()
  const edited = { ...SAVED[0], weight_lbs: 1500 }
  const { status, body } = await run(post(asFile([edited, SAVED[1], NEW])), db.deps)
  assert.equal(status, 200, JSON.stringify(body))
  assert.equal(body.warningCount, 0)
  assert.match(body.infos[0].message, /2 saved events in the file were skipped/)
  assert.equal(inserted(db).params.includes(1500), false)
})

test('a new row for a different animal refuses the whole file', async () => {
  const db = fakeDb()
  const { status, body } = await run(post(asFile([...SAVED, NEW, { ...NEW, tag_number: '300', event_date: '2026-10-11' }])), db.deps)
  assert.equal(status, 422)
  assert.match(body.errors[0].message, /for tag 248 only, but this row is for tag 300/)
  assert.equal(db.queries.some((q) => q.sql.startsWith('insert')), false)
})

test('a row_id that is not on file, or belongs to another animal, is refused', async () => {
  const stray = { ...SAVED[0], row_id: 'zzz' }
  const none = await run(post(asFile([stray, NEW])), fakeDb().deps)
  assert.equal(none.status, 422)
  assert.match(none.body.errors[0].message, /not on file/)
  const other = fakeDb({ saved: [{ ...SAVED[0], tag_number: '300' }] })
  const wrong = await run(post(asFile([SAVED[0], NEW])), other.deps)
  assert.equal(wrong.status, 422)
  assert.match(wrong.body.errors[0].message, /belongs to tag 300, not tag 248/)
})

test('a file with no new rows says so', async () => {
  const { status, body } = await run(post(asFile(SAVED)), fakeDb().deps)
  assert.equal(status, 422)
  assert.match(body.errors[0].message, /No new rows found/)
})

test('a sold or deceased animal takes no new events', async () => {
  const sold = fakeDb({ herdRows: [{ ...HERD_ROW, event_type: 'sold', event_date: '2026-09-01' }] })
  const { status, body } = await run(post(asFile([...SAVED, NEW])), sold.deps)
  assert.equal(status, 422)
  assert.match(body.errors[0].message, /was sold on 2026-09-01, so no new events can be added/)
  const dead = fakeDb({ herdRows: [{ ...HERD_ROW, event_type: 'deceased', event_date: '2026-09-01' }] })
  assert.match((await run(post(asFile([...SAVED, NEW])), dead.deps)).body.errors[0].message, /reported deceased/)
})

test('a sale can be recorded with its price on the Transactions tab', async () => {
  const db = fakeDb()
  const sale = { tag_number: '248', event_date: '2026-10-10', event_type: 'sold', weight_lbs: 1040 }
  const { status, body } = await run(post(asFile([...SAVED, sale], [{ transaction_date: '2026-10-10', transaction_type: 'sale', price_per_cwt: 140 }])), db.deps)
  assert.equal(status, 200, JSON.stringify(body))
  const txn = db.queries.find((q) => q.sql.startsWith('insert into ranch_demo.cattle_transactions'))
  assert.ok(txn.params.includes(1456))                         // 1040 lb x $140 / 100
})

test('the same new row sent twice is a duplicate', async () => {
  const { status, body } = await run(post(asFile([...SAVED, NEW])), fakeDb({ duplicate: true }).deps)
  assert.equal(status, 409)
  assert.match(body.message, /already uploaded/)
})

test('without an animal tag a file with row_ids is refused and points to Animal Lookup', async () => {
  const { status, body } = await run(post(asFile([...SAVED, NEW]), {}), fakeDb().deps)
  assert.equal(status, 422)
  assert.match(body.errors[0].message, /Animal Lookup page/)
})

test('a malformed animal tag is a plain 400', async () => {
  for (const tag of ['248; drop table', 'x'.repeat(21), '24 8']) {
    assert.equal((await run(post(asFile([...SAVED, NEW]), { animal_tag: tag }), fakeDb().deps)).status, 400, tag)
  }
})

test('separateSavedRows: saved rows are skipped as they are, however the spreadsheet wrote them', () => {
  const sheet = { headers: [], rows: [{ row: 2, values: { ...SAVED[0], event_date: new Date('2026-05-14T00:00:00Z'), tag_number: 248 } }] }
  const r = separateSavedRows(sheet, new Map([['r1', SAVED[0]]]), '248')
  assert.deepEqual([r.skipped, r.rows.length, r.errors.length], [1, 0, 0])
})
