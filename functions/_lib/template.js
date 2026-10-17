// The "download a pre-filled template" request, with the database passed in so it can be tested.
// The visitor says what happened and when (for example a working day on 2026-10-20) and the reply
// is an .xlsx with the rows already started:
//   worked, preg_check, sold, deceased: one Events row per matching animal on the ranch
//   moved:    one row per animal not already in the chosen pasture, with that pasture as its location
//   birth:    one row per mother (pregnant cows, or all cows), with her tag in mother_tag_number
//   purchase: a chosen number of empty Events rows
// Purchases and sales also get a Transactions row with only the date and type, ready for the price.
// A preg_check is a worked row with "preg check" in the notes. The server fills in an animal's type,
// gender and so on from its stored record when the upload arrives, so these rows can stay short.

import { buildWorkbook, MAX_ROWS } from './xlsx-write.js'
import { EVENT_COLUMNS, TRANSACTION_COLUMNS, ANIMAL_TYPES, GENDERS, LOCATIONS } from './schema-v8.js'
import { MIN_DATE } from './validate.js'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const MAX_FILL_ROWS = MAX_ROWS - 1 // 500
export const FILL_EVENT_TYPES = ['worked', 'preg_check', 'moved', 'sold', 'deceased', 'birth', 'purchase']
export const MOTHER_CHOICES = ['pregnant', 'all']

const UPLOAD_COLUMNS = EVENT_COLUMNS.filter((c) => c.key !== 'row_id') // row_id is only in a history download

const HERD_SQL = `select tag_number, type, gender, birth_year, location, last_event_type,
                         last_event_date::text as last_event_date, last_weight_lbs,
                         last_weight_date::text as last_weight_date, currently_pregnant
                    from ranch_demo.current_cattle`

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

// A filter can be sent several times (location=Home Pasture&location=North Pasture). Returns the
// chosen values in their canonical spelling; an empty list means "any". Null if a value is not allowed.
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

// Tags sort numerically when they are all digits, so 99 comes before 101.
export function byTag(a, b) {
  const x = String(a.tag_number)
  const y = String(b.tag_number)
  const xd = /^\d+$/.test(x)
  const yd = /^\d+$/.test(y)
  if (xd && yd) return Number(x) - Number(y) || x.localeCompare(y)
  if (xd !== yd) return xd ? -1 : 1
  return x.localeCompare(y)
}

const joinNotes = (...parts) => parts.filter(Boolean).join('; ')

const HOW_TO_UPLOAD = 'When the rows are right, upload the file on the Add Events page. Every row left in the file is saved as an event.'
const NOTES_HELP = [
  'The notes column says what was done on a working day, for example "vaccinated (Pyramid 5); weighed", "preg check", "preg check - open", "weaned" or "castrated".',
  'A pregnancy check also needs estimated_months_pregnant (1 to 9). For an open cow, write "preg check - open" and leave the months blank.',
]

function instructionLines(kind) {
  const lines = {
    worked: ['One row per animal on the ranch. Delete the rows for animals you did not work, and fill in anything left blank (usually weight_lbs).', ...NOTES_HELP],
    preg_check: ['One row per cow on the ranch, marked "preg check" in the notes.', 'Fill in estimated_months_pregnant (1 to 9) for each pregnant cow. For an open cow, change the notes to "preg check - open" and leave the months blank.', 'Delete the rows for cows you did not check.'],
    moved: ['One row per animal, with location set to the pasture it moved to and the old pasture in the notes. Delete the rows for animals that did not move.'],
    sold: ['One row per animal. Fill in weight_lbs (the sale weight) and delete the rows for animals you did not sell.', 'The Transactions tab has a row for the sale: add price_per_cwt (or a total_amount) and leave tag_numbers blank. It then covers every sold row dated that day. Delete the row if there is no sale to record.'],
    deceased: ['One row per animal. A deceased animal leaves the herd, and no later events can be added for it. Delete the rows for animals that did not die.'],
    birth: ["One row per mother, with her tag in mother_tag_number and the calf's location copied from her.", "Add each calf's tag_number and gender, and a birth weight in weight_lbs if you have one. Delete the rows for cows that have not calved."],
    purchase: ["Add each animal's tag_number, gender and type (Cow, Bull or Calf), plus weight_lbs if you have it.", 'The Transactions tab has a row for the purchase: add price_per_head (or a total_amount) and leave tag_numbers blank. It then covers every purchase row dated that day.'],
    blank: ['Fill in the Events tab, one row per event. Required: tag_number, event_date and event_type. Location, type and gender are filled in from the animal\'s record if you leave them blank for an animal already on the ranch; a new animal needs them.', 'Event types: worked, moved, birth, purchase, sold, deceased. See the notes help below.', ...NOTES_HELP, 'The optional Transactions tab records money for purchases and sales. Leave tag_numbers blank and the row covers every purchase (or sold) event dated that day.'],
  }
  return [...lines[kind], '', HOW_TO_UPLOAD, 'Only the Events and Transactions tabs are read. This tab is ignored.'].map((line) => ({ text: line }))
}

/** The .xlsx bytes for the given rows. kind picks the instructions ('blank' for the empty template). */
export function templateWorkbook({ events = [], transactions = [], kind = 'blank' }) {
  return buildWorkbook([
    { name: 'Events', columns: UPLOAD_COLUMNS, rows: events },
    { name: 'Transactions', columns: TRANSACTION_COLUMNS, rows: transactions },
    { name: 'Instructions', columns: [{ key: 'text', header: 'How to use this template', kind: 'str', width: 130 }], rows: instructionLines(kind) },
  ])
}

/**
 * @param {Request} request  POST form: event_type, event_date, note, cf-turnstile-response, plus
 *   worked, preg_check, sold, deceased: location, type, gender (each optional, each may repeat)
 *   moved: to (the pasture moved to, required), and the same optional filters
 *   birth: mothers = pregnant | all, and optional location filters
 *   purchase: count (1 to 500) and optionally one each of location, type and gender
 * @param {{ withClient: (fn: (client) => Promise<any>) => Promise<any>,
 *           verifyHuman?: (token: string, ip: string | null) => Promise<boolean>,
 *           today?: string }} deps
 */
export async function handleTemplate(request, { withClient, verifyHuman, today = new Date().toISOString().slice(0, 10) }) {
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

  const kind = FILL_EVENT_TYPES.find((t) => t === text(form, 'event_type').toLowerCase())
  if (!kind) return json({ ok: false, message: `Pick an event type: ${FILL_EVENT_TYPES.join(', ')}.` }, 400)
  const eventDate = text(form, 'event_date')
  if (!validDate(eventDate, today)) {
    return json({ ok: false, message: `Enter the date as year-month-day (for example ${today}), between ${MIN_DATE} and tomorrow.` }, 400)
  }
  const locations = filterValues(form, 'location', LOCATIONS)
  const types = filterValues(form, 'type', ANIMAL_TYPES)
  const genders = filterValues(form, 'gender', GENDERS)
  if (locations === null || types === null || genders === null) return json({ ok: false, message: 'That filter value is not one of the allowed choices.' }, 400)
  const note = text(form, 'note')
  if (note.length > 500) return json({ ok: false, message: 'The note can be at most 500 characters.' }, 400)

  let count = 0 // purchases: how many rows
  let mothers = 'pregnant' // births: which cows
  let to = '' // moves: the pasture
  if (kind === 'purchase') {
    if (locations.length > 1 || types.length > 1 || genders.length > 1) {
      return json({ ok: false, message: 'For a purchase, choose at most one location, type and gender.' }, 400)
    }
    count = Number(text(form, 'count'))
    if (!Number.isInteger(count) || count < 1 || count > MAX_FILL_ROWS) {
      return json({ ok: false, message: `Enter how many animals, from 1 to ${MAX_FILL_ROWS}.` }, 400)
    }
  } else if (kind === 'birth') {
    mothers = text(form, 'mothers') || 'pregnant'
    if (!MOTHER_CHOICES.includes(mothers)) return json({ ok: false, message: 'Choose pregnant cows only, or all cows.' }, 400)
  } else if (kind === 'moved') {
    to = LOCATIONS.find((l) => l.toLowerCase() === text(form, 'to').toLowerCase()) ?? ''
    if (!to) return json({ ok: false, message: `Choose the pasture the animals moved to: ${LOCATIONS.join(', ')}.` }, 400)
  }

  let herd
  try {
    herd = (await withClient((client) => client.query(HERD_SQL))).rows.map((r) => ({ ...r, last_weight_lbs: r.last_weight_lbs == null ? null : Number(r.last_weight_lbs) }))
  } catch (err) {
    console.error('template herd query failed:', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Please try again later.' }, 500)
  }

  let events
  let transactions = []
  if (kind === 'purchase') {
    // Empty rows to be filled with tags. The Transactions row has only the date and type: with no
    // tags listed, the upload ties it to every purchase dated that day and works out the count.
    events = Array.from({ length: count }, () => ({
      event_date: eventDate, event_type: 'purchase', location: locations[0], type: types[0], gender: genders[0], notes: note,
    }))
    transactions = [{ transaction_date: eventDate, transaction_type: 'purchase' }]
  } else if (kind === 'birth') {
    const found = herd
      .filter((a) => a.type === 'Cow' && matches(locations, a.location) && (mothers === 'all' || a.currently_pregnant === true))
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
    // The calf takes its mother's location; the tag and gender are left for the visitor.
    events = found.map((a) => ({
      event_date: eventDate, event_type: 'birth', location: a.location, type: 'Calf',
      mother_tag_number: a.tag_number, birth_year: Number(eventDate.slice(0, 4)), notes: note,
    }))
  } else {
    let pool = herd.filter((a) => matches(locations, a.location) && matches(types, a.type) && matches(genders, a.gender))
    if (kind === 'preg_check') pool = pool.filter((a) => a.type === 'Cow')
    if (kind === 'moved') pool = pool.filter((a) => a.location !== to)
    const found = pool.sort(byTag)
    if (found.length === 0) return json({ ok: false, message: 'No animals on the ranch match those filters.' }, 404)
    if (found.length > MAX_FILL_ROWS) {
      return json({ ok: false, message: `${found.length} animals match, but a file holds at most ${MAX_FILL_ROWS}. Narrow the list with a filter.` }, 400)
    }
    events = found.map((a) => ({
      tag_number: a.tag_number, event_date: eventDate, location: a.location, type: a.type, gender: a.gender,
      ...(kind === 'worked' && { event_type: 'worked', notes: note }),
      ...(kind === 'preg_check' && { event_type: 'worked', notes: joinNotes('preg check', note) }),
      ...(kind === 'moved' && { event_type: 'moved', location: to, notes: `moved from ${a.location} to ${to}${note ? ` — ${note}` : ''}` }),
      ...(kind === 'sold' && { event_type: 'sold', notes: note }),
      ...(kind === 'deceased' && { event_type: 'deceased', notes: note }),
    }))
    if (kind === 'sold') transactions = [{ transaction_date: eventDate, transaction_type: 'sale' }]
  }

  let bytes
  try {
    bytes = templateWorkbook({ events, transactions, kind })
  } catch (err) {
    console.error('template build failed:', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Please try again later.' }, 500)
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': XLSX_TYPE,
      'content-disposition': `attachment; filename="cattle_template_${kind}_${eventDate}.xlsx"`,
      'cache-control': 'no-store',
      'x-row-count': String(events.length), // lets the page say how many rows without opening the file
    },
  })
}
