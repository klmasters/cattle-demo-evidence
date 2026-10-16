// The "download a pre-filled template" request, with the database and the blank template
// passed in so it can be tested. The visitor says what they did and when (for example
// vaccination on 2026-10-20) and, optionally, narrows the list; the reply is an .xlsx with one
// Events row per matching animal on the ranch.

import { fillTemplate, byTag, MAX_FILL_ROWS } from './fill-template.js'
import { ANIMAL_TYPES, BREEDS, EVENT_TYPES, LOCATIONS, MIN_DATE } from './validate.js'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Birth and purchase are for animals that are not on the ranch yet, so there is nothing to pre-fill.
export const FILL_EVENT_TYPES = EVENT_TYPES.filter((t) => t !== 'birth' && t !== 'purchase')

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const text = (form, name) => {
  const value = form.get(name)
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : ''
}

// A real calendar date from MIN_DATE to tomorrow (the same range the upload accepts), else false.
function validDate(value, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (d.toISOString().slice(0, 10) !== value) return false
  const tomorrow = new Date(`${today}T00:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return value >= MIN_DATE && value <= tomorrow.toISOString().slice(0, 10)
}

// A filter can be sent several times (location=Ranch&location=Eureka). Returns the chosen values
// in their canonical spelling; an empty list means "any". Returns null if a value is not allowed.
function filterValues(form, name, list) {
  const chosen = []
  for (const raw of form.getAll(name)) {
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '') continue
    const match = list.find((item) => item.toLowerCase() === value.toLowerCase())
    if (!match) return null
    if (!chosen.includes(match)) chosen.push(match)
  }
  return chosen
}

/**
 * @param {Request} request  POST form: event_type, event_date, note, cf-turnstile-response, and
 *                           location, type and breed (each optional, and each may be sent more than once)
 * @param {{ withClient: (fn: (client) => Promise<any>) => Promise<any>,
 *           loadTemplate: () => Promise<Uint8Array>,
 *           verifyHuman?: (token: string, ip: string | null) => Promise<boolean>,
 *           today?: string }} deps
 */
export async function handleTemplate(request, { withClient, loadTemplate, verifyHuman, today = new Date().toISOString().slice(0, 10) }) {
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

  const eventType = FILL_EVENT_TYPES.find((t) => t === text(form, 'event_type').toLowerCase())
  if (!eventType) return json({ ok: false, message: `Pick an event type: ${FILL_EVENT_TYPES.join(', ')}.` }, 400)
  const eventDate = text(form, 'event_date')
  if (!validDate(eventDate, today)) {
    return json({ ok: false, message: `Enter the date as year-month-day (for example ${today}), between ${MIN_DATE} and tomorrow.` }, 400)
  }
  const locations = filterValues(form, 'location', LOCATIONS)
  const types = filterValues(form, 'type', ANIMAL_TYPES)
  const breeds = filterValues(form, 'breed', BREEDS)
  if (locations === null || types === null || breeds === null) return json({ ok: false, message: 'That filter value is not one of the allowed choices.' }, 400)
  const note = text(form, 'note')
  if (note.length > 500) return json({ ok: false, message: 'The note can be at most 500 characters.' }, 400)

  let herd
  try {
    herd = await withClient(async (client) => {
      const { rows } = await client.query(
        `select tag_number, breed, type, location, last_event_type,
                last_event_date::text as last_event_date, last_weight_lbs, last_weight_date::text as last_weight_date
           from ranch_demo.current_cattle`,
      )
      return rows.map((r) => ({ ...r, last_weight_lbs: r.last_weight_lbs == null ? null : Number(r.last_weight_lbs) }))
    })
  } catch (err) {
    console.error('template herd query failed:', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Please try again later.' }, 500)
  }

  const chosen = herd
    .filter((a) => (!locations.length || locations.includes(a.location))
      && (!types.length || types.includes(a.type))
      && (!breeds.length || breeds.includes(a.breed)))
    .sort(byTag)
  if (chosen.length === 0) return json({ ok: false, message: 'No animals on the ranch match those filters.' }, 404)
  if (chosen.length > MAX_FILL_ROWS) {
    return json({ ok: false, message: `${chosen.length} animals match, but a file holds at most ${MAX_FILL_ROWS}. Narrow the list with a filter.` }, 400)
  }

  let bytes
  try {
    bytes = fillTemplate(await loadTemplate(), {
      herd,
      events: chosen.map((a) => ({
        tag_number: a.tag_number,
        event_date: eventDate,
        event_type: eventType,
        location: a.location,
        breed: a.breed,
        type: a.type,
        notes: note,
      })),
    })
  } catch (err) {
    console.error('template build failed:', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Please try again later.' }, 500)
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': XLSX_TYPE,
      'content-disposition': `attachment; filename="cattle_template_${eventType}_${eventDate}.xlsx"`,
      'cache-control': 'no-store',
      'x-animal-count': String(chosen.length), // lets the page say "X animals" without opening the file
    },
  })
}
