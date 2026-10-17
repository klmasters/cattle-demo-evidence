// Run with: npm run test:upload
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validate } from '../functions/_lib/validate.js'
import { parseCsv, parseXlsx, sheetFromGrid } from '../functions/_lib/parse.js'

const TODAY = '2026-10-13'
const EVENT_HEADER = ['tag_number', 'event_date', 'event_type', 'location', 'type', 'gender', 'weight_lbs', 'notes', 'mother_tag_number', 'estimated_months_pregnant']
const TXN_HEADER = ['transaction_date', 'transaction_type', 'tag_numbers', 'head_count', 'total_weight_lbs', 'price_per_cwt', 'price_per_head', 'total_amount']

// Build a sheet from rows given as arrays in header order.
const events = (...rows) => sheetFromGrid([EVENT_HEADER, ...rows])
const txns = (...rows) => sheetFromGrid([TXN_HEADER, ...rows])
const run = (e, t = null, options = {}) => validate({ events: e, transactions: t }, { today: TODAY, ...options })
const messages = (list) => list.map((m) => `${m.sheet} ${m.row} ${m.column}`)

// A row of events: ev(tag, date, type, extras...)
const row = (tag, date, type, o = {}) => [tag, date, type, o.location ?? null, o.type ?? null, o.gender ?? null, o.weight ?? null, o.notes ?? null, o.mother ?? null, o.months ?? null]
const buy = (tag, date = '2026-05-02') => row(tag, date, 'purchase', { location: 'Home Pasture', type: 'Cow', gender: 'Female' })
const txn = (date, type, tags, head, wt, cwt, pph, total) => [date, type, tags, head, wt, cwt, pph, total]

const animal = (o = {}) => ({
  status: 'active', lastEventDate: '2026-04-01', location: 'Home Pasture', type: 'Cow', gender: 'Female',
  birth_year: 2019, mother_tag_number: null, date_bought: null, ...o,
})

test('a clean upload passes and values are normalized', () => {
  const r = run(events(['901', '5/3/2026', 'PURCHASE', 'home pasture', 'cow', 'female', '1150.5', null, null, null]))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.events[0].event_date, '2026-05-03')
  assert.equal(r.events[0].event_type, 'purchase')
  assert.equal(r.events[0].location, 'Home Pasture')
  assert.equal(r.events[0].type, 'Cow')
  assert.equal(r.events[0].gender, 'Female')
  assert.equal(r.events[0].weight_lbs, 1150.5)
})

test('numeric tags from Excel become text', () => {
  const r = run(events(row(248, '2026-05-03', 'worked'), row('249.0', '2026-05-03', 'worked')))
  assert.deepEqual(r.events.map((e) => e.tag_number), ['248', '249'])
})

test('missing required values and bad lists are errors with row numbers', () => {
  const r = run(events([null, '2026-05-03', 'vaccinated', 'Moon', null, null, null, null, null, null]))
  assert.equal(r.ok, false)
  assert.deepEqual(messages(r.errors), ['Events 2 tag_number', 'Events 2 event_type', 'Events 2 location'])
  assert.deepEqual(r.events, [])
})

test('the old v7 names are no longer accepted', () => {
  const r = run(events(row('1', '2026-05-03', 'weight', { location: 'Ranch' })))
  assert.deepEqual(messages(r.errors), ['Events 2 event_type', 'Events 2 location'])
})

test('dates must be real and in range', () => {
  const r = run(events(row('1', '2026-02-30', 'worked'), row('2', '1999-12-31', 'worked'), row('3', '2027-01-01', 'worked'), row('4', 'last tuesday', 'worked')))
  assert.equal(r.errorCount, 4)
})

test('weights must be sane', () => {
  const r = run(events(row('1', '2026-05-03', 'worked', { weight: 99999 }), row('2', '2026-05-03', 'worked', { weight: 0 })))
  assert.deepEqual(messages(r.errors), ['Events 2 weight_lbs', 'Events 3 weight_lbs'])
})

test('exact duplicate rows are errors', () => {
  const r = run(events(row('1', '2026-05-03', 'worked'), row('1', '2026-05-03', 'worked')))
  assert.deepEqual(messages(r.errors), ['Events 3 tag_number'])
})

test('events after sold or deceased in the same file are errors; same day is fine', () => {
  const r = run(events(row('1', '2026-05-03', 'sold'), row('1', '2026-05-03', 'worked'), row('1', '2026-05-04', 'moved', { location: 'North Pasture' })))
  assert.deepEqual(messages(r.errors), ['Events 4 event_date'])
})

test('a row_id means the event is already saved, so it is refused', () => {
  const sheet = sheetFromGrid([['row_id', ...EVENT_HEADER], ['abc', ...row('1', '2026-05-03', 'worked')]])
  const r = run(sheet)
  assert.deepEqual(messages(r.errors), ['Events 2 row_id'])
})

test('a birth without the mother is only a warning', () => {
  const r = run(events(row('7', '2026-03-02', 'birth', { location: 'Home Pasture', gender: 'Male' })))
  assert.equal(r.ok, true)
  assert.deepEqual(messages(r.warnings), ['Events 2 mother_tag_number'])
})

test('pregnancy checks: months with the note, none for an open cow, nothing else carries months', () => {
  const good = run(events(row('1', '2026-10-05', 'worked', { notes: 'preg check; vaccinated (Pyramid 5)', months: 4 }),
                          row('2', '2026-10-05', 'worked', { notes: 'preg check - open' })))
  assert.equal(good.ok, true, JSON.stringify(good.errors))
  assert.equal(good.events[0].estimated_months_pregnant, 4)
  const bad = run(events(row('1', '2026-10-05', 'worked', { notes: 'preg check' }),
                         row('2', '2026-10-05', 'worked', { notes: 'preg check - open', months: 3 }),
                         row('3', '2026-10-05', 'worked', { notes: 'weighed', months: 3 }),
                         row('4', '2026-10-05', 'sold', { notes: 'preg check', months: 3 }),
                         row('5', '2026-10-05', 'worked', { notes: 'preg check', months: 12 })))
  assert.deepEqual(messages(bad.errors), ['Events 2 estimated_months_pregnant', 'Events 3 estimated_months_pregnant', 'Events 4 estimated_months_pregnant', 'Events 5 event_type', 'Events 6 estimated_months_pregnant'])
  assert.equal(bad.errorCount, 5)
})

test('more than 500 rows is rejected', () => {
  const many = Array.from({ length: 501 }, (_, i) => row(String(1000 + i), '2026-05-03', 'worked'))
  const r = run(events(...many))
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /limit is 500/)
})

test('missing Events tab or missing columns are errors', () => {
  assert.equal(validate({ events: null, transactions: null }, { today: TODAY }).ok, false)
  const r = run(sheetFromGrid([['tag_number', 'event_date'], ['1', '2026-05-03']]))
  assert.match(r.errors[0].message, /missing required column\(s\): event_type/)
})

// ---- transactions ----

test('transactions: totals and per-head price are worked out from what is given', () => {
  const e = events(buy('902'), row('903', '2026-05-02', 'sold'))
  const byHead = run(e, txns(txn('2026-05-02', 'purchase', '902', null, null, null, 3000, null), txn('2026-05-02', 'sale', '903', null, 600, 350, null, null)))
  assert.equal(byHead.ok, true, JSON.stringify(byHead.errors))
  const [p, s] = byHead.transactions
  assert.equal(p.head_count, 1)
  assert.equal(p.total_amount, 3000)
  assert.equal(s.total_amount, 2100)        // 600 lb x $350 / 100
  assert.equal(s.price_per_head, 2100)
})

test('transactions: weight is added up from the sold events, and price_per_cwt is enough', () => {
  const e = events(row('5', '2026-05-02', 'sold', { weight: 500 }), row('6', '2026-05-02', 'sold', { weight: 700 }))
  const r = run(e, txns(txn('2026-05-02', 'sale', null, null, null, 300, null, null)))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const t = r.transactions[0]
  assert.equal(t.total_weight_lbs, 1200)
  assert.equal(t.total_amount, 3600)
  assert.equal(t.head_count, 2)
  assert.equal(t.price_per_head, 1800)
  assert.equal(r.infoCount, 2)               // tags filled in, weight added up
})

test('transactions: tag without a matching event is an error; a different date is a warning', () => {
  const none = run(events(buy('902')), txns(txn('2026-05-02', 'purchase', '999', null, null, null, 3000, null)))
  assert.deepEqual(messages(none.errors), ['Transactions 2 tag_numbers'])
  const off = run(events(buy('902')), txns(txn('2026-05-09', 'purchase', '902', null, null, null, 3000, null)))
  assert.equal(off.ok, true)
  assert.deepEqual(messages(off.warnings), ['Transactions 2 tag_numbers'])
})

test('transactions: amounts must agree with each other, and one way to price is required', () => {
  const e = events(buy('1'), buy('2'))
  const base = (...cells) => run(e, txns(txn('2026-05-02', 'purchase', '1, 2', ...cells)))
  assert.equal(base(2, null, null, 3000, 6000).ok, true)
  assert.deepEqual(messages(base(2, null, null, 3000, 7000).errors), ['Transactions 2 total_amount'])   // per head x count
  assert.deepEqual(messages(base(2, 1000, 300, null, 9999).errors), ['Transactions 2 total_amount'])   // weight x cwt
  assert.deepEqual(messages(base(2, null, null, null, null).errors), ['Transactions 2 total_amount'])   // nothing to price from
  assert.deepEqual(messages(base(3, null, null, 3000, null).errors), ['Transactions 2 head_count'])     // count vs tags
  const badType = run(e, txns(txn('2026-05-02', 'trade', '1', null, null, null, 3000, null)))
  assert.deepEqual(messages(badType.errors), ['Transactions 2 transaction_type'])
})

test('transactions: blank tags need an amount and a matching event', () => {
  const noEvents = run(events(buy('902', '2026-05-09')), txns(txn('2026-05-02', 'purchase', null, null, null, null, 3000, null)))
  assert.deepEqual(messages(noEvents.errors), ['Transactions 2 tag_numbers'])
  const noPrice = run(events(buy('902')), txns(txn('2026-05-02', 'purchase', null, null, null, null, null, null)))
  assert.deepEqual(messages(noPrice.errors), ['Transactions 2 total_amount'])
})

test('transactions: two blank-tag rows on one date are ambiguous; a row that lists tags keeps its own', () => {
  const e = events(buy('1'), buy('2'), buy('3'))
  const two = run(e, txns(txn('2026-05-02', 'purchase', null, null, null, null, 3000, null), txn('2026-05-02', 'purchase', null, null, null, null, 3500, null)))
  assert.deepEqual(messages(two.errors), ['Transactions 3 tag_numbers'])
  const mixed = run(e, txns(txn('2026-05-02', 'purchase', '3', null, null, null, 3500, null), txn('2026-05-02', 'purchase', null, null, null, null, 3000, null)))
  assert.equal(mixed.ok, true, JSON.stringify(mixed.errors))
  assert.deepEqual(mixed.transactions[1].tag_numbers, ['1', '2'])
  assert.equal(mixed.transactions[1].total_amount, 6000)
})

test('a purchase or sold event with no transaction is a warning', () => {
  const r = run(events(buy('902'), row('903', '2026-05-02', 'sold')))
  assert.equal(r.ok, true)
  assert.deepEqual(messages(r.warnings), ['Events 2 event_type', 'Events 3 event_type'])
})

// ---- the live herd ----

test('herd: blanks are filled from the animal record, so a short row is enough', () => {
  const herd = new Map([['123', animal({ birth_year: 2019, date_bought: '2024-09-08' })]])
  const r = run(events(row('123', '2026-10-10', 'worked', { notes: 'vaccinated (Pyramid 5)' })), null, { herd })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const e = r.events[0]
  assert.deepEqual([e.type, e.gender, e.location, e.birth_year, e.date_bought], ['Cow', 'Female', 'Home Pasture', 2019, '2024-09-08'])
})

test('herd: a move needs its destination, and moving to where it already is warns', () => {
  const herd = new Map([['123', animal()]])
  assert.deepEqual(messages(run(events(row('123', '2026-10-10', 'moved')), null, { herd }).errors), ['Events 2 location'])
  const same = run(events(row('123', '2026-10-10', 'moved', { location: 'Home Pasture' })), null, { herd })
  assert.equal(same.ok, true)
  assert.deepEqual(messages(same.warnings), ['Events 2 location'])
})

test('herd: events after a recorded sale are errors; an active purchase is a warning', () => {
  const herd = new Map([['901', animal({ status: 'sold', lastEventDate: '2026-04-01' })], ['902', animal()]])
  const r = run(events(row('901', '2026-05-03', 'worked'), buy('902')), null, { herd })
  assert.deepEqual(messages(r.errors), ['Events 2 tag_number'])
  assert.deepEqual(messages(r.warnings).includes('Events 3 event_type'), true)
})

test('herd: an unknown tag needs a birth or purchase row in the file first', () => {
  const herd = new Map()
  const r = run(events(row('555', '2026-10-10', 'worked'), row('555', '2026-10-11', 'sold')), null, { herd })
  assert.deepEqual(messages(r.errors), ['Events 2 tag_number'])          // once per tag
  const early = run(events(row('555', '2026-10-01', 'worked'), buy('555', '2026-10-10')), null, { herd })
  assert.deepEqual(messages(early.errors), ['Events 2 event_date'])
})

test('herd: a new calf takes type Calf and its birth year, and its later rows copy from the birth row', () => {
  const herd = new Map([['123', animal()]])
  const r = run(events(row('800', '2026-03-02', 'birth', { location: 'North Pasture', gender: 'Female', mother: '123', weight: 80 }),
                       row('800', '2026-10-05', 'worked', { weight: 520 })), null, { herd })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.deepEqual([r.events[0].type, r.events[0].birth_year], ['Calf', 2026])
  assert.deepEqual([r.events[1].type, r.events[1].gender, r.events[1].location, r.events[1].mother_tag_number, r.events[1].birth_year],
    ['Calf', 'Female', 'North Pasture', '123', 2026])
})

test('herd: a new animal needs location and gender, and a birth cannot reuse an existing tag', () => {
  const herd = new Map([['123', animal()]])
  const r = run(events(row('800', '2026-03-02', 'birth', { mother: '123' })), null, { herd })
  assert.deepEqual(messages(r.errors), ['Events 2 location', 'Events 2 gender'])
  const reuse = run(events(row('123', '2026-03-02', 'birth', { location: 'Home Pasture', gender: 'Female', mother: '123' })), null, { herd })
  assert.deepEqual(messages(reuse.errors), ['Events 2 tag_number'])
})

test('herd: gender follows a Cow or Bull type; an unknown mother is a warning', () => {
  const r = run(events(row('901', '2026-05-02', 'purchase', { location: 'Home Pasture', type: 'Bull' }),
                       row('902', '2026-05-03', 'birth', { location: 'Home Pasture', gender: 'Male', mother: '777' })), null, { herd: new Map() })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.events[0].gender, 'Male')
  assert.equal(r.events[0].date_bought, '2026-05-02')
  assert.ok(messages(r.warnings).includes('Events 3 mother_tag_number'))
})

// ---- reading files ----

test('CSV input: BOM, quotes and blank lines', () => {
  const csv = '﻿tag_number,event_date,event_type,location,type,gender,notes\n' +
    '901,2026-05-03,purchase,Home Pasture,Cow,Female,"checked, ok"\n\n'
  const r = run(parseCsv(csv))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.events[0].notes, 'checked, ok')
})

test('xlsx input: date cells, numeric tags, tab names, ignored Instructions tab', async () => {
  const bytes = readFileSync(new URL('./fixtures/good.xlsx', import.meta.url))
  const sheets = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const r = validate(sheets, { today: TODAY })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.events.length, 3)
  assert.equal(r.events[0].tag_number, '901')
  assert.equal(r.events[0].event_date, '2026-05-01')
  assert.equal(r.transactions.length, 1)
  assert.equal(r.transactions[0].total_amount, 3000)
  assert.equal(r.warnings.length, 0)
})

test('a non-xlsx file is rejected with a plain message', async () => {
  await assert.rejects(parseXlsx(new TextEncoder().encode('hello').buffer), /Could not read/)
})

test('Excel date numbers (a date saved without a date format) are accepted', () => {
  const r = run(events(row('901', 46308, 'worked')))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.events[0].event_date, '2026-10-13')
  assert.equal(run(events(row('901', 5, 'worked'))).ok, false)
})
