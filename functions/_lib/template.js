// The "download a pre-filled template" request, with the database and the blank template
// passed in so it can be tested. The visitor says what happened and when (for example
// vaccination on 2026-10-20) and the reply is an .xlsx with the rows already started:
//   vaccination, weight, pregnant, sold, deceased: one Events row per matching animal on the ranch
//   birth:    one Events row per mother (pregnant cows, or all cows), with her tag in mother_tag_number
//   purchase: a chosen number of empty Events rows, plus one Transactions row ready for the price

import { fillTemplate, byTag, MAX_FILL_ROWS } from './fill-template.js'
import { ANIMAL_TYPES, BREEDS, LOCATIONS, MIN_DATE } from './validate.js'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const FILL_EVENT_TYPES = ['vaccination', 'weight', 'pregnant', 'sold', 'deceased', 'birth', 'purchase']
export const MOTHER_CHOICES = ['pregnant', 'all']

// Cows still on the ranch whose latest pregnancy check has no birth after it (the same
// definition the Pregnancy & Calving dashboard uses). Voided uploads are ignored.
const PREGNANT_COWS_SQL = `
  with ev as (
    select e.tag_number, e.event_type, e.event_date, e.mother_tag_number
      from ranch_demo.cattle_events e
      left join ranch_demo.upload_batches b on b.batch_id = e.batch_id
     where b.voided is not true
  ), checks as (
    select tag_number, max(event_date) as last_check from ev where event_type = 'pregnant' group by tag_number
  ), births as (
    select mother_tag_number as tag_number, max(event_date) as last_birth
      from ev where event_type = 'birth' and mother_tag_number is not null group by mother_tag_number
  )
  select c.tag_number
    from ranch_demo.current_cattle c
    join checks k on k.tag_number = c.tag_number
    left join births b on b.tag_number = c.tag_number
   where b.last_birth is null or b.last_birth < k.last_check`

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

const matches = (chosen, value) => chosen.length === 0 || chosen.includes(value)

/**
 * @param {Request} request  POST form: event_type, event_date, note, cf-turnstile-response, plus
 *   existing-animal types and births: location, type, breed (each optional, each may repeat; a birth
 *     ignores type), and for births mothers = pregnant | all
 *   purchase: count (1 to 500) and optionally one each of location, type, breed
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

  let count = 0 // purchases: how many rows
  let mothers = 'pregnant' // births: which cows
  if (eventType === 'purchase') {
    if (locations.length > 1 || types.length > 1 || breeds.length > 1) {
      return json({ ok: false, message: 'For a purchase, choose at most one location, type and breed.' }, 400)
    }
    count = Number(text(form, 'count'))
    if (!Number.isInteger(count) || count < 1 || count > MAX_FILL_ROWS) {
      return json({ ok: false, message: `Enter how many animals, from 1 to ${MAX_FILL_ROWS}.` }, 400)
    }
  } else if (eventType === 'birth') {
    mothers = text(form, 'mothers') || 'pregnant'
    if (!MOTHER_CHOICES.includes(mothers)) return json({ ok: false, message: 'Choose pregnant cows only, or all cows.' }, 400)
  }

  let herd
  let pregnantTags = null // births from pregnant cows only: the tags of those cows
  try {
    await withClient(async (client) => {
      const { rows } = await client.query(
        `select tag_number, breed, type, location, last_event_type,
                last_event_date::text as last_event_date, last_weight_lbs, last_weight_date::text as last_weight_date
           from ranch_demo.current_cattle`,
      )
      herd = rows.map((r) => ({ ...r, last_weight_lbs: r.last_weight_lbs == null ? null : Number(r.last_weight_lbs) }))
      if (eventType === 'birth' && mothers === 'pregnant') {
        pregnantTags = new Set((await client.query(PREGNANT_COWS_SQL)).rows.map((r) => r.tag_number))
      }
    })
  } catch (err) {
    console.error('template herd query failed:', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Please try again later.' }, 500)
  }

  let events
  let transactions = []
  if (eventType === 'purchase') {
    // Empty rows to be filled with tags. The Transactions row has only the date and type: with no
    // tags listed, the upload ties it to every purchase dated that day and works out the count.
    events = Array.from({ length: count }, () => ({
      event_date: eventDate, event_type: 'purchase', location: locations[0], breed: breeds[0], type: types[0], notes: note,
    }))
    transactions = [{ transaction_date: eventDate, transaction_type: 'purchase' }]
  } else if (eventType === 'birth') {
    const found = herd
      .filter((a) => a.type === 'Cow' && matches(locations, a.location) && matches(breeds, a.breed) && (!pregnantTags || pregnantTags.has(a.tag_number)))
      .sort(byTag)
    if (found.length === 0) {
      return json({
        ok: false,
        message: mothers === 'pregnant'
          ? 'No cows are currently marked pregnant. Choose "all cows" instead, or upload pregnancy checks first.'
          : 'No cows on the ranch match those filters.',
      }, 404)
    }
    if (found.length > MAX_FILL_ROWS) {
      return json({ ok: false, message: `${found.length} cows match, but a file holds at most ${MAX_FILL_ROWS}. Narrow the list with a filter.` }, 400)
    }
    // The calf takes its mother's breed and location; the tag is left for the visitor.
    events = found.map((a) => ({
      event_date: eventDate, event_type: 'birth', location: a.location, breed: a.breed, type: 'Calf',
      mother_tag_number: a.tag_number, birth_year: Number(eventDate.slice(0, 4)), notes: note,
    }))
  } else {
    const found = herd.filter((a) => matches(locations, a.location) && matches(types, a.type) && matches(breeds, a.breed)).sort(byTag)
    if (found.length === 0) return json({ ok: false, message: 'No animals on the ranch match those filters.' }, 404)
    if (found.length > MAX_FILL_ROWS) {
      return json({ ok: false, message: `${found.length} animals match, but a file holds at most ${MAX_FILL_ROWS}. Narrow the list with a filter.` }, 400)
    }
    events = found.map((a) => ({
      tag_number: a.tag_number, event_date: eventDate, event_type: eventType, location: a.location, breed: a.breed, type: a.type, notes: note,
    }))
  }

  let bytes
  try {
    bytes = fillTemplate(await loadTemplate(), { herd, events, transactions })
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
      'x-row-count': String(events.length), // lets the page say how many rows without opening the file
    },
  })
}
