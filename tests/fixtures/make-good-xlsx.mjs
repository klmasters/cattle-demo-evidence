// Regenerates tests/fixtures/good.xlsx (run: node tests/fixtures/make-good-xlsx.mjs).
// A small valid upload: a purchase, a birth and a working day, one purchase transaction,
// and an Instructions tab that the upload must ignore.
import { writeFileSync } from 'node:fs'
import { buildWorkbook } from '../../functions/_lib/xlsx-write.js'
import { EVENT_COLUMNS, TRANSACTION_COLUMNS } from '../../functions/_lib/schema-v8.js'

const bytes = buildWorkbook([
  {
    name: 'Events',
    columns: EVENT_COLUMNS.filter((c) => c.key !== 'row_id'),
    rows: [
      { tag_number: '901', event_date: '2026-05-01', event_type: 'purchase', location: 'Home Pasture', type: 'Cow', gender: 'Female', weight_lbs: 1150 },
      { tag_number: '902', event_date: '2026-05-02', event_type: 'birth', location: 'North Pasture', gender: 'Male', mother_tag_number: '901', weight_lbs: 80 },
      { tag_number: '901', event_date: '2026-05-03', event_type: 'worked', notes: 'vaccinated (Pyramid 5); weighed', weight_lbs: 1100 },
    ],
  },
  {
    name: 'Transactions',
    columns: TRANSACTION_COLUMNS,
    rows: [{ transaction_date: '2026-05-01', transaction_type: 'purchase', tag_numbers: '901', price_per_head: 3000 }],
  },
  { name: 'Instructions', columns: [{ key: 'text', header: 'Ignored', kind: 'str', width: 40 }], rows: [{ text: 'This tab is not read.' }] },
])
writeFileSync(new URL('./good.xlsx', import.meta.url), bytes)
console.log('wrote good.xlsx,', bytes.length, 'bytes')
