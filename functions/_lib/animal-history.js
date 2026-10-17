// The "download this animal's history" request, with the database passed in so it can be tested.
// POST form: tag, cf-turnstile-response. The reply is an .xlsx: an Events tab with one row per
// event for that tag, oldest first, in the upload column layout, plus an Instructions tab.
// The first column, row_id, is the event's id in the database. A visitor adds new events as rows
// with a blank row_id; rows that keep their row_id are the existing history.

import { buildWorkbook } from './xlsx-write.js'
import { EVENT_COLUMNS, EVENT_TYPES } from './schema-v8.js'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Voided uploads are left out, the same as everywhere else on the site.
const HISTORY_SQL = `
  select e.row_id, e.tag_number, e.event_date::text as event_date, e.event_type, e.location, e.type,
         e.gender, e.birth_year, e.mother_tag_number, e.date_bought::text as date_bought,
         e.weight_lbs, e.estimated_months_pregnant, e.notes
    from ranch_demo.cattle_events e
    left join ranch_demo.upload_batches b on b.batch_id = e.batch_id
   where e.tag_number = $1 and b.voided is not true
   order by e.event_date, e.id`

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

function instructions(tag, exit) {
  const lines = [
    `This file is the full record for tag ${tag}, one row per event, oldest first.`,
    '',
    exit
      ? `Tag ${tag} was ${exit.event_type === 'sold' ? 'sold' : 'reported deceased'} on ${exit.event_date}, so no new events can be added for it. This copy is for reading.`
      : 'To add an event: type a new row under the last one on the Events tab.',
    ...(exit
      ? []
      : [
          `  - Leave row_id blank. A row with a blank row_id is a new event.`,
          `  - Fill in tag_number (${tag}), event_date and event_type, and anything else that applies. Every new row must be for tag ${tag}.`,
          '  - Do not edit or delete the existing rows. The history is kept as recorded, and any change to an existing row is ignored.',
          '  - Then upload the file on the Animal Lookup page.',
        ]),
    '',
    `Event types: ${EVENT_TYPES.join(', ')}.`,
    '  worked: a working day. Say what was done in notes, for example "vaccinated (Pyramid 5); weighed", "preg check" or "preg check - open".',
    '  moved: location is where the animal moved to.',
    '  birth: the calf is the tag_number; put the mother in mother_tag_number. weight_lbs is the birth weight.',
    '  purchase, sold, deceased: the animal enters or leaves the herd.',
    'Only the Events tab is read when you upload. This tab is ignored.',
  ]
  return lines.map((text) => ({ text }))
}

/**
 * @param {Request} request
 * @param {{ withClient: (fn: (client) => Promise<any>) => Promise<any>,
 *           verifyHuman?: (token: string, ip: string | null) => Promise<boolean> }} deps
 */
export async function handleAnimalHistory(request, { withClient, verifyHuman }) {
  if (request.method !== 'POST') return json({ ok: false, message: 'Use POST.' }, 405)

  let form
  try {
    form = await request.formData()
  } catch {
    return json({ ok: false, message: 'Could not read the request.' }, 400)
  }
  if (verifyHuman) {
    const token = form.get('cf-turnstile-response')
    if (!(await verifyHuman(typeof token === 'string' ? token : '', request.headers.get('cf-connecting-ip')))) {
      return json({ ok: false, message: 'The "are you a person" check did not pass. Reload the page and try again.' }, 403)
    }
  }

  const raw = form.get('tag')
  const tag = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : ''
  if (!tag || tag.length > 40) return json({ ok: false, message: 'Pick a tag number first.' }, 400)

  let rows
  try {
    rows = (await withClient((client) => client.query(HISTORY_SQL, [tag]))).rows
  } catch (err) {
    console.error('animal history query failed:', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Please try again later.' }, 500)
  }
  if (rows.length === 0) return json({ ok: false, message: `No animal with tag ${tag} is on file.` }, 404)

  const exit = rows.find((r) => r.event_type === 'sold' || r.event_type === 'deceased')
  let bytes
  try {
    bytes = buildWorkbook([
      { name: 'Events', columns: EVENT_COLUMNS, rows },
      { name: 'Instructions', columns: [{ key: 'text', header: `About this file (tag ${tag})`, kind: 'str', width: 120 }], rows: instructions(tag, exit) },
    ])
  } catch (err) {
    console.error('animal history build failed:', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Please try again later.' }, 500)
  }

  const safe = tag.replace(/[^A-Za-z0-9_-]/g, '_')
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': XLSX_TYPE,
      'content-disposition': `attachment; filename="animal_${safe}_history.xlsx"`,
      'cache-control': 'no-store',
      'x-row-count': String(rows.length),
    },
  })
}
