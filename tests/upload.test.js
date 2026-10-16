// Run with: npm run test:upload
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validate } from '../functions/_lib/validate.js'
import { parseCsv, parseXlsx, sheetFromGrid } from '../functions/_lib/parse.js'

const TODAY = '2026-10-13'
const EVENT_HEADER = ['tag_number', 'event_date', 'event_type', 'location', 'breed', 'type', 'weight_lbs', 'notes', 'mother_tag_number', 'estimated_due_month']
const TXN_HEADER = ['transaction_date', 'transaction_type', 'tag_numbers', 'head_count', 'price_per_head', 'total_amount']

// Build a sheet from rows given as arrays in header order.
const events = (...rows) => sheetFromGrid([EVENT_HEADER, ...rows])
const txns = (...rows) => sheetFromGrid([TXN_HEADER, ...rows])
const run = (e, t = null, options = {}) => validate({ events: e, transactions: t }, { today: TODAY, ...options })
const messages = (list) => list.map((m) => `${m.sheet} ${m.row} ${m.column}`)

const purchase = ['902', '2026-05-02', 'purchase', 'Eureka', 'Red Angus', 'Cow', null, null, null, null]
const weight = ['901', '2026-05-03', 'weight', 'Ranch', 'Black Angus', 'Calf', 90, null, null, null]

test('a clean upload passes and values are normalized', () => {
  const r = run(events(['901', '5/3/2026', 'WEIGHT', 'ranch', 'black angus', 'calf', '90.5', null, null, null]))
  assert.equal(r.ok, true)
  assert.deepEqual(r.events[0].event_date, '2026-05-03')
  assert.equal(r.events[0].event_type, 'weight')
  assert.equal(r.events[0].location, 'Ranch')
  assert.equal(r.events[0].breed, 'Black Angus')
  assert.equal(r.events[0].weight_lbs, 90.5)
})

test('numeric tags from Excel become text', () => {
  const r = run(events([248, '2026-05-03', 'weight', 'Ranch', 'Red Angus', 'Cow', 1100, null, null, null],
                       ['249.0', '2026-05-03', 'weight', 'Ranch', 'Red Angus', 'Cow', 1100, null, null, null]))
  assert.deepEqual(r.events.map((e) => e.tag_number), ['248', '249'])
})

test('missing required values and bad lists are errors with row numbers', () => {
  const r = run(events([null, '2026-05-03', 'vaccinated', 'Moon', 'Red Angus', 'Cow', null, null, null, null]))
  assert.equal(r.ok, false)
  assert.deepEqual(messages(r.errors), ['Events 2 tag_number', 'Events 2 event_type', 'Events 2 location'])
  assert.deepEqual(r.events, [])
})

test('dates must be real and in range', () => {
  const r = run(events(
    ['1', '2026-02-30', 'weight', 'Ranch', 'Red Angus', 'Cow', 100, null, null, null],
    ['2', '1999-12-31', 'weight', 'Ranch', 'Red Angus', 'Cow', 100, null, null, null],
    ['3', '2027-01-01', 'weight', 'Ranch', 'Red Angus', 'Cow', 100, null, null, null],
    ['4', 'last tuesday', 'weight', 'Ranch', 'Red Angus', 'Cow', 100, null, null, null]))
  assert.equal(r.errorCount, 4)
})

test('weight events need a weight; weights must be sane', () => {
  const r = run(events(
    ['1', '2026-05-03', 'weight', 'Ranch', 'Red Angus', 'Cow', null, null, null, null],
    ['2', '2026-05-03', 'weight', 'Ranch', 'Red Angus', 'Cow', 99999, null, null, null]))
  assert.deepEqual(messages(r.errors), ['Events 2 weight_lbs', 'Events 3 weight_lbs'])
})

test('exact duplicate rows are errors', () => {
  const r = run(events(weight, weight))
  assert.deepEqual(messages(r.errors), ['Events 3 tag_number'])
})

test('events after sold or deceased in the same file are errors; same day is fine', () => {
  const sold = ['901', '2026-05-10', 'sold', 'Ranch', 'Black Angus', 'Calf', null, null, null, null]
  const sameDay = ['901', '2026-05-10', 'weight', 'Ranch', 'Black Angus', 'Calf', 95, null, null, null]
  const later = ['901', '2026-05-11', 'weight', 'Ranch', 'Black Angus', 'Calf', 96, null, null, null]
  assert.equal(run(events(sold, sameDay)).ok, true)
  assert.deepEqual(messages(run(events(sold, later)).errors), ['Events 3 event_date'])
})

test('birth without mother, and pregnant without due month, are warnings only', () => {
  const r = run(events(
    ['5', '2026-01-10', 'birth', 'Ranch', 'Red Angus', 'Calf', 80, null, null, null],
    ['6', '2026-01-10', 'pregnant', 'Ranch', 'Red Angus', 'Cow', null, null, null, null]))
  assert.equal(r.ok, true)
  assert.deepEqual(messages(r.warnings), ['Events 2 mother_tag_number', 'Events 3 estimated_due_month'])
})

test('more than 500 rows is rejected', () => {
  const rows = Array.from({ length: 501 }, (_, i) => [String(i + 1), '2026-05-03', 'weight', 'Ranch', 'Red Angus', 'Cow', 100, null, null, null])
  const r = run(events(...rows))
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /501 rows/)
})

test('missing Events tab or missing columns are errors', () => {
  assert.equal(run(null).ok, false)
  const r = run(sheetFromGrid([['tag_number', 'event_date'], ['1', '2026-05-03']]))
  assert.match(r.errors[0].message, /missing required column/)
})

test('transactions: good, matched to events', () => {
  const r = run(events(purchase), txns(['2026-05-02', 'purchase', '902', 1, 1800, 1800]))
  assert.equal(r.ok, true)
  assert.deepEqual(r.transactions[0].tag_numbers, ['902'])
  assert.equal(r.warnings.length, 0)
})

test('transactions: tag without a matching event is an error', () => {
  const r = run(events(purchase), txns(['2026-05-02', 'purchase', '902, 903', 2, 1800, 3600]))
  assert.deepEqual(messages(r.errors), ['Transactions 2 tag_numbers'])
})

test('transactions: different date is a warning, not an error', () => {
  const r = run(events(purchase), txns(['2026-05-09', 'purchase', '902', 1, 1800, 1800]))
  assert.equal(r.ok, true)
  assert.deepEqual(messages(r.warnings), ['Transactions 2 tag_numbers'])
})

test('transactions: head count, totals, duplicates and types are checked', () => {
  const r = run(events(purchase), txns(
    ['2026-05-02', 'purchase', '902', 2, 1800, 3600],
    ['2026-05-02', 'purchase', '902', 1, 1800, 5000],
    ['2026-05-02', 'trade', '902', 1, 1800, 1800],
    ['2026-05-02', 'purchase', '902, 902', 2, 1800, 3600]))
  assert.deepEqual(messages(r.errors), ['Transactions 2 head_count', 'Transactions 3 total_amount', 'Transactions 4 transaction_type', 'Transactions 5 tag_numbers'])
})

// A transaction row with no tags covers the purchase (or sold) events dated the same day.
const buy = (tag, date = '2026-05-02') => [tag, date, 'purchase', 'Eureka', 'Red Angus', 'Cow', null, null, null, null]
const sell = (tag, date = '2026-05-02') => [tag, date, 'sold', 'Ranch', 'Black Angus', 'Calf', null, null, null, null]

test('transactions: blank tags link to the purchase events on that date, and counts are worked out', () => {
  const r = run(events(buy('902'), buy('903'), buy('904', '2026-05-09')), txns(['2026-05-02', 'purchase', null, null, 1800, null]))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.deepEqual(r.transactions[0].tag_numbers, ['902', '903'])
  assert.equal(r.transactions[0].head_count, 2)
  assert.equal(r.transactions[0].total_amount, 3600)
  assert.match(r.warnings.find((w) => w.sheet === 'Transactions').message, /902, 903/)
  // Only the 05-09 purchase (row 4) is left without a transaction; the two linked ones are covered.
  assert.deepEqual(r.warnings.filter((w) => w.sheet === 'Events').map((w) => w.row), [4])
})

test('transactions: blank tags work for sales, and a given total or head count is checked', () => {
  const sale = run(events(sell('901'), sell('905')), txns(['2026-05-02', 'sale', null, 2, 900, 1800]))
  assert.equal(sale.ok, true, JSON.stringify(sale.errors))
  assert.deepEqual(sale.transactions[0].tag_numbers, ['901', '905'])
  const wrongCount = run(events(buy('902'), buy('903')), txns(['2026-05-02', 'purchase', null, 3, 1800, null]))
  assert.deepEqual(messages(wrongCount.errors), ['Transactions 2 head_count'])
  const wrongTotal = run(events(buy('902'), buy('903')), txns(['2026-05-02', 'purchase', null, null, 1800, 5000]))
  assert.deepEqual(messages(wrongTotal.errors), ['Transactions 2 total_amount'])
})

test('transactions: blank tags need price_per_head and a matching event', () => {
  const noPrice = run(events(buy('902')), txns(['2026-05-02', 'purchase', null, null, null, null]))
  assert.deepEqual(messages(noPrice.errors), ['Transactions 2 price_per_head'])
  const noEvents = run(events(buy('902')), txns(['2026-05-09', 'purchase', null, null, 1800, null]))
  assert.deepEqual(messages(noEvents.errors), ['Transactions 2 tag_numbers'])
})

test('transactions: two blank-tag rows on one date are ambiguous; a row that lists tags keeps its own', () => {
  const twice = run(events(buy('902'), buy('903')), txns(['2026-05-02', 'purchase', null, null, 1800, null], ['2026-05-02', 'purchase', null, null, 2000, null]))
  assert.deepEqual(messages(twice.errors), ['Transactions 3 tag_numbers'])
  const mixed = run(events(buy('902'), buy('903'), buy('904')), txns(['2026-05-02', 'purchase', '902', 1, 2500, 2500], ['2026-05-02', 'purchase', null, null, 1800, null]))
  assert.equal(mixed.ok, true, JSON.stringify(mixed.errors))
  assert.deepEqual(mixed.transactions[1].tag_numbers, ['903', '904'])
})

test('transactions: a row that lists tags still needs head_count and total_amount', () => {
  const r = run(events(buy('902')), txns(['2026-05-02', 'purchase', '902', null, 1800, null]))
  assert.deepEqual(messages(r.errors), ['Transactions 2 head_count', 'Transactions 2 total_amount'])
})

test('a purchase or sold event with no transaction is a warning', () => {
  const r = run(events(purchase))
  assert.equal(r.ok, true)
  assert.deepEqual(messages(r.warnings), ['Events 2 event_type'])
})

test('live herd snapshot: events after a recorded sale are errors', () => {
  const herd = new Map([['901', { status: 'sold', lastEventDate: '2026-04-01' }], ['902', { status: 'active', lastEventDate: '2026-04-01' }]])
  const r = run(events(weight, purchase), null, { herd })
  assert.deepEqual(messages(r.errors), ['Events 2 tag_number'])
  assert.deepEqual(messages(r.warnings).includes('Events 3 event_type'), true)
})

test('CSV input: BOM, quotes and blank lines', () => {
  const csv = '﻿tag_number,event_date,event_type,location,breed,type,weight_lbs,notes\n' +
    '901,2026-05-03,weight,Ranch,Black Angus,Calf,90,"checked, ok"\n\n'
  const r = run(parseCsv(csv))
  assert.equal(r.ok, true)
  assert.equal(r.events[0].notes, 'checked, ok')
})

test('xlsx input: date cells, numeric tags, tab names, ignored Herd tab', async () => {
  const bytes = readFileSync(new URL('./fixtures/good.xlsx', import.meta.url))
  const sheets = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const r = validate(sheets, { today: TODAY })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.events.length, 3)
  assert.equal(r.events[0].tag_number, '901')
  assert.equal(r.events[0].event_date, '2026-05-01')
  assert.equal(r.transactions.length, 1)
  assert.equal(r.warnings.length, 0)
})

test('a non-xlsx file is rejected with a plain message', async () => {
  await assert.rejects(parseXlsx(new TextEncoder().encode('hello').buffer), /Could not read/)
})

test('Excel date numbers (a date saved without a date format) are accepted', () => {
  const r = run(events(['901', 46308, 'weight', 'Ranch', 'Black Angus', 'Calf', 90, null, null, null]))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.events[0].event_date, '2026-10-13')
  assert.equal(run(events(['901', 5, 'weight', 'Ranch', 'Black Angus', 'Calf', 90, null, null, null])).ok, false)
})
