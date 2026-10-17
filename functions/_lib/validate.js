// Validates an uploaded cattle spreadsheet. Pure JavaScript with no database or
// network access, so it runs the same in Cloudflare and in local tests.
//
// Input: sheets built by parse.js. A "sheet" is { headers: [...], rows: [{ row, values }] }
// where `row` is the spreadsheet row number and `values` maps column name -> cell value.
//
// Output: { ok, errors, warnings, infos, events, transactions, counts }. Any error means the
// whole upload is rejected (all or nothing); warnings let it through; infos are not problems,
// they only report what the server filled in.
//
// Two passes (see handle.js). Without `options.herd` only the checks inside the file run. With a
// herd snapshot (what is already stored about the tags in the file) the server also fills in
// blanks from the animal's record and checks the file against it.

import { ANIMAL_TYPES, EVENT_TYPES, GENDERS, LOCATIONS, TRANSACTION_TYPES, UPLOAD_EVENT_COLUMNS, SAVED_EVENT_COLUMNS, TRANSACTION_COLUMNS as TXN_COLUMN_DEFS } from './schema-v8.js'

export { ANIMAL_TYPES, EVENT_TYPES, GENDERS, LOCATIONS, TRANSACTION_TYPES }

export const MAX_ROWS = 500
const MAX_MESSAGES = 50
export const MIN_DATE = '2000-01-01'

export const EVENT_COLUMNS = UPLOAD_EVENT_COLUMNS
const EVENT_REQUIRED = ['tag_number', 'event_date', 'event_type']
export const TRANSACTION_COLUMNS = TXN_COLUMN_DEFS.map((c) => c.key)
const TRANSACTION_REQUIRED = ['transaction_date', 'transaction_type']

const PREG_CHECK = /preg check/i
const PREG_OPEN = /preg check\s*-\s*open/i

// ---- small helpers -------------------------------------------------------------

// Trim text, strip control characters, and turn blanks into null.
function clean(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    return text === '' ? null : text
  }
  return value
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// Returns 'YYYY-MM-DD' for a real calendar date, otherwise null.
function isoDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

// Accepts a Date cell, an Excel date number, 2026-05-28 (optionally followed by a time),
// or 5/28/2026. Excel counts days from 1899-12-30; some programs save dates as that plain
// number without a date format, so 46308 means 2026-10-13. Only numbers in a plausible
// range (years 2000 to 2100) count as dates.
function parseDate(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(Math.floor(value)) || value < 36526 || value > 73050) return null
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
    return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  }
  if (typeof value !== 'string') return null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(value)
  if (m) return isoDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  if (m) return isoDate(+m[3], +m[1], +m[2])
  return null
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  return Number(text)
}

// Tags are text. Excel may hand us 248 (number) or "248.0"; both become "248".
function parseTag(value) {
  let text
  if (typeof value === 'number') text = Number.isInteger(value) ? String(value) : null
  else if (typeof value === 'string') text = value.replace(/^(\d+)\.0+$/, '$1')
  else text = null
  if (text === null || !/^[A-Za-z0-9-]{1,20}$/.test(text)) return null
  return text
}

// Match against an allowed list ignoring case; returns the canonical spelling or null.
function fromList(value, list) {
  if (typeof value !== 'string') return null
  return list.find((item) => item.toLowerCase() === value.toLowerCase()) ?? null
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const round2 = (n) => Math.round(n * 100) / 100

// ---- main ----------------------------------------------------------------------

/**
 * @param {{events: Sheet|null, transactions: Sheet|null}} sheets
 * @param {{today?: string, herd?: Map<string, HerdEntry>}} [options]
 *   today: 'YYYY-MM-DD' (tests set it).
 *   onlyTag: the upload is one animal's history file: every row must be for this tag, and a sold
 *     or deceased animal takes no new events.
 *   herd: what is already stored about the tags in the file, tag -> { status: 'active' | 'sold' |
 *     'deceased', lastEventDate, location, type, gender, birth_year, mother_tag_number, date_bought }.
 */
export function validate(sheets, options = {}) {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const maxDate = addDays(today, 1)
  const thisYear = Number(today.slice(0, 4))
  const herd = options.herd ?? null
  const onlyTag = options.onlyTag ?? null

  const errors = []
  const warnings = []
  const infos = [] // not problems: things the server did for the visitor (such as filling in tags)
  const error = (sheet, row, column, message) => errors.push({ sheet, row, column, message })
  const warn = (sheet, row, column, message) => warnings.push({ sheet, row, column, message })
  const info = (sheet, row, column, message) => infos.push({ sheet, row, column, message })

  const events = []
  const transactions = []
  let eventsReadable = true

  // --- file-level checks ---
  const eventsSheet = sheets.events
  if (!eventsSheet) {
    error('Events', null, null, 'No Events tab found. The file needs a tab named "Events".')
    return finish()
  }
  checkHeaders('Events', eventsSheet, EVENT_COLUMNS, EVENT_REQUIRED)
  if (sheets.transactions) {
    checkHeaders('Transactions', sheets.transactions, TRANSACTION_COLUMNS, TRANSACTION_REQUIRED)
  }
  if (errors.length) return finish()

  const eventRows = nonEmptyRows(eventsSheet)
  const txnRows = sheets.transactions ? nonEmptyRows(sheets.transactions) : []
  if (eventRows.length === 0) error('Events', null, null, 'The Events tab has no rows.')
  if (eventRows.length > MAX_ROWS) error('Events', null, null, `The Events tab has ${eventRows.length} rows; the limit is ${MAX_ROWS}.`)
  if (txnRows.length > MAX_ROWS) error('Transactions', null, null, `The Transactions tab has ${txnRows.length} rows; the limit is ${MAX_ROWS}.`)
  if (errors.length) return finish()

  // --- events ---
  for (const { row, values } of eventRows) {
    const event = checkEventRow(row, values)
    if (event) events.push(event)
  }
  checkEventConsistency()
  if (herd && errors.length === 0) applyHerd()

  // --- transactions ---
  // Matching transactions to events only makes sense when every event row was readable.
  eventsReadable = errors.length === 0
  // A transaction row may leave tag_numbers blank: it then covers the purchase (or sold) events
  // dated the same day, skipping tags another row lists itself. So that rule is predictable,
  // note the tags listed by hand first, and let only one blank row claim a given type and date.
  const listedTags = new Set()
  const claimedDays = new Set()
  for (const { values } of txnRows) {
    if (values.tag_numbers == null) continue
    const wanted = String(values.transaction_type).toLowerCase() === 'purchase' ? 'purchase' : 'sold'
    for (const part of String(values.tag_numbers).split(/[,;|]/)) {
      const tag = parseTag(part.trim())
      if (tag !== null) listedTags.add(`${wanted}|${tag}`)
    }
  }
  for (const { row, values } of txnRows) {
    const txn = checkTransactionRow(row, values)
    if (txn) transactions.push(txn)
  }
  checkEventsHaveTransactions()

  return finish()

  // ---- inner functions (share errors/warnings/events above) ----

  function finish() {
    return {
      ok: errors.length === 0,
      errors: inOrder(errors).slice(0, MAX_MESSAGES),
      errorCount: errors.length,
      warnings: inOrder(warnings).slice(0, MAX_MESSAGES),
      warningCount: warnings.length,
      infos: inOrder(infos).slice(0, MAX_MESSAGES),
      infoCount: infos.length,
      events: errors.length ? [] : events,
      transactions: errors.length ? [] : transactions,
      counts: { events: events.length, transactions: transactions.length },
    }
  }

  // Messages read best by tab, then row (the herd pass adds some out of order).
  function inOrder(list) {
    return [...list].sort((a, b) => a.sheet.localeCompare(b.sheet) || (a.row ?? 0) - (b.row ?? 0))
  }

  function checkHeaders(name, sheet, known, required) {
    const missing = required.filter((c) => !sheet.headers.includes(c))
    if (missing.length) {
      error(name, 1, null, `The ${name} tab is missing required column(s): ${missing.join(', ')}.`)
    }
    const unknown = sheet.headers.filter((h) => h && !known.includes(h))
    if (unknown.length) {
      warn(name, 1, null, `Ignoring unrecognized column(s): ${unknown.join(', ')}.`)
    }
  }

  function nonEmptyRows(sheet) {
    return sheet.rows
      .map((r) => ({ row: r.row, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, clean(v)])) }))
      .filter((r) => Object.values(r.values).some((v) => v !== null))
  }

  function required(sheetName, row, column, values) {
    if (values[column] === null || values[column] === undefined) {
      error(sheetName, row, column, 'This is required.')
      return false
    }
    return true
  }

  function dateField(sheetName, row, column, value, { limits }) {
    const iso = parseDate(value)
    if (!iso) {
      error(sheetName, row, column, `"${value}" is not a date. Write it year-month-day, e.g. 2026-05-28.`)
      return null
    }
    if (limits && (iso < MIN_DATE || iso > maxDate)) {
      error(sheetName, row, column, `${iso} is outside the allowed range (${MIN_DATE} to ${maxDate}).`)
      return null
    }
    return iso
  }

  function listField(sheetName, row, column, value, list) {
    const match = fromList(value, list)
    if (!match) error(sheetName, row, column, `"${value}" is not one of: ${list.join(', ')}.`)
    return match
  }

  function checkEventRow(row, v) {
    const S = 'Events'
    const before = errors.length
    const out = Object.fromEntries(SAVED_EVENT_COLUMNS.map((c) => [c, null]))
    out.source_row = row

    for (const c of EVENT_REQUIRED) required(S, row, c, v)

    if (v.row_id != null) {
      error(S, row, 'row_id', 'This row has a row_id, so it is an event that is already saved. Leave row_id blank for a new event. (A file from an animal\'s history download is uploaded on the Animal Lookup page.)')
    }
    if (v.tag_number != null) {
      out.tag_number = parseTag(v.tag_number)
      if (!out.tag_number) error(S, row, 'tag_number', `"${v.tag_number}" is not a valid tag (letters, digits and hyphens, up to 20 characters).`)
      else if (onlyTag && out.tag_number !== onlyTag) {
        error(S, row, 'tag_number', `This file is for tag ${onlyTag} only, but this row is for tag ${out.tag_number}. Add events for other animals on the Add Events page.`)
      }
    }
    if (v.event_date != null) out.event_date = dateField(S, row, 'event_date', v.event_date, { limits: true })
    if (v.event_type != null) out.event_type = listField(S, row, 'event_type', v.event_type, EVENT_TYPES)
    if (v.location != null) out.location = listField(S, row, 'location', v.location, LOCATIONS)
    if (v.type != null) out.type = listField(S, row, 'type', v.type, ANIMAL_TYPES)
    if (v.gender != null) out.gender = listField(S, row, 'gender', v.gender, GENDERS)

    if (v.weight_lbs != null) {
      const w = parseNumber(v.weight_lbs)
      if (w === null || w <= 0 || w > 3000) error(S, row, 'weight_lbs', `"${v.weight_lbs}" is not a weight between 0 and 3000 lb.`)
      else out.weight_lbs = w
    }
    if (v.birth_year != null) {
      const y = parseNumber(v.birth_year)
      if (y === null || !Number.isInteger(y) || y < 1980 || y > thisYear) error(S, row, 'birth_year', `"${v.birth_year}" is not a year between 1980 and ${thisYear}.`)
      else out.birth_year = y
    }
    if (v.estimated_months_pregnant != null) {
      const n = parseNumber(v.estimated_months_pregnant)
      if (n === null || !Number.isInteger(n) || n < 1 || n > 9) error(S, row, 'estimated_months_pregnant', `"${v.estimated_months_pregnant}" is not a whole number of months between 1 and 9.`)
      else out.estimated_months_pregnant = n
    }
    if (v.date_bought != null) out.date_bought = dateField(S, row, 'date_bought', v.date_bought, { limits: true })
    if (v.mother_tag_number != null) {
      out.mother_tag_number = parseTag(v.mother_tag_number)
      if (!out.mother_tag_number) error(S, row, 'mother_tag_number', `"${v.mother_tag_number}" is not a valid tag.`)
    }
    if (v.notes != null) {
      const notes = String(v.notes)
      if (notes.length > 500) error(S, row, 'notes', `Notes are ${notes.length} characters; the limit is 500.`)
      else out.notes = notes
    }

    // A pregnancy check is a working day with "preg check" in the notes. A positive check gives the
    // months pregnant; an open cow ("preg check - open") has none.
    const notes = out.notes ?? ''
    if (PREG_CHECK.test(notes) && out.event_type && out.event_type !== 'worked') {
      error(S, row, 'event_type', 'A pregnancy check is recorded as event_type worked, with "preg check" in the notes.')
    } else if (out.event_type === 'worked' && PREG_CHECK.test(notes)) {
      if (PREG_OPEN.test(notes) && v.estimated_months_pregnant != null) {
        error(S, row, 'estimated_months_pregnant', 'An open cow ("preg check - open") has no months pregnant. Leave this blank.')
      } else if (!PREG_OPEN.test(notes) && v.estimated_months_pregnant == null) {
        error(S, row, 'estimated_months_pregnant', 'A pregnancy check needs the months pregnant. For an open cow, write "preg check - open" in the notes instead.')
      }
    } else if (v.estimated_months_pregnant != null) {
      error(S, row, 'estimated_months_pregnant', 'Months pregnant only goes with a "preg check" note on a worked event.')
    }

    if (out.event_type === 'birth' && v.mother_tag_number == null) warn(S, row, 'mother_tag_number', "A birth event usually has the mother's tag.")

    return errors.length === before ? out : null
  }

  function checkEventConsistency() {
    const S = 'Events'
    // Exact duplicates: same tag, date and event type.
    const seen = new Map()
    for (const e of events) {
      const key = `${e.tag_number}|${e.event_date}|${e.event_type}`
      if (seen.has(key)) error(S, e.source_row, 'tag_number', `Duplicate of row ${seen.get(key)} (same tag, date and event type).`)
      else seen.set(key, e.source_row)
    }
    // No events after a sold or deceased event for the same tag.
    const ends = new Map()
    for (const e of events) {
      if ((e.event_type === 'sold' || e.event_type === 'deceased') && (!ends.has(e.tag_number) || e.event_date < ends.get(e.tag_number).date)) {
        ends.set(e.tag_number, { date: e.event_date, type: e.event_type })
      }
    }
    for (const e of events) {
      const end = ends.get(e.tag_number)
      if (end && e.event_date > end.date) {
        error(S, e.source_row, 'event_date', `Tag ${e.tag_number} was ${end.type} on ${end.date}, so it cannot have an event on ${e.event_date}.`)
      }
    }
    // Same tag with a different type or gender in different rows.
    const traits = new Map()
    for (const e of events) {
      const prior = traits.get(e.tag_number)
      if (!prior) traits.set(e.tag_number, { type: e.type, gender: e.gender, row: e.source_row, warned: false })
      else if (!prior.warned && ((prior.type && e.type && prior.type !== e.type) || (prior.gender && e.gender && prior.gender !== e.gender))) {
        prior.warned = true
        warn(S, e.source_row, 'type', `Tag ${e.tag_number} has a different type or gender than on row ${prior.row}.`)
      }
    }
  }

  // Needs the herd snapshot. Fills blanks from the animal's record, then checks each row against it.
  function applyHerd() {
    const S = 'Events'
    // An animal that is not stored yet must arrive in this file by a birth or purchase row.
    const intro = new Map()
    for (const e of events) {
      if ((e.event_type === 'birth' || e.event_type === 'purchase') && !intro.has(e.tag_number)) intro.set(e.tag_number, e)
    }
    const missing = new Set()
    let refused = false
    // A new animal's birth or purchase row goes first, so its other rows can copy from it.
    const order = [...events.filter((e) => intro.get(e.tag_number) === e), ...events.filter((e) => intro.get(e.tag_number) !== e)]
    for (const e of order) {
      const known = herd.get(e.tag_number)
      const starts = intro.get(e.tag_number)
      if (known) {
        if (onlyTag && known.status !== 'active') {
          if (!refused) {
            refused = true
            error(S, e.source_row, 'tag_number', `Tag ${e.tag_number} was ${known.status === 'sold' ? 'sold' : 'reported deceased'} on ${known.lastEventDate}, so no new events can be added for it.`)
          }
          continue
        }
        if (e.event_type === 'birth') {
          error(S, e.source_row, 'tag_number', `Tag ${e.tag_number} is already on file, so it cannot be born again. Use a new tag for the calf.`)
        } else if ((known.status === 'sold' || known.status === 'deceased') && e.event_date > known.lastEventDate) {
          error(S, e.source_row, 'tag_number', `Tag ${e.tag_number} is already recorded as ${known.status} (${known.lastEventDate}).`)
        } else if (known.status === 'active' && e.event_type === 'purchase') {
          warn(S, e.source_row, 'event_type', `Tag ${e.tag_number} is already on the ranch, so a purchase is unusual.`)
        }
      } else if (!starts) {
        if (!missing.has(e.tag_number)) {
          missing.add(e.tag_number)
          error(S, e.source_row, 'tag_number', `Tag ${e.tag_number} is not on file. Add a birth or purchase row for it first.`)
        }
        continue
      } else if (e.event_date < starts.event_date) {
        error(S, e.source_row, 'event_date', `Tag ${e.tag_number} has a ${starts.event_type} on ${starts.event_date}, so it cannot have an event on ${e.event_date}.`)
      }

      // Blanks come from the stored record, or for a new animal from its birth or purchase row.
      const base = known ?? starts ?? {}
      const isStart = e === starts
      for (const c of ['type', 'gender', 'birth_year', 'mother_tag_number', 'date_bought']) {
        if (e[c] == null && base[c] != null && !isStart) e[c] = base[c]
      }
      if (e.event_type === 'birth') {
        if (e.type == null) e.type = 'Calf'
        if (e.birth_year == null) e.birth_year = Number(e.event_date.slice(0, 4))
      }
      if (e.event_type === 'purchase' && e.date_bought == null) e.date_bought = e.event_date
      if (e.gender == null && e.type === 'Cow') e.gender = 'Female'
      if (e.gender == null && e.type === 'Bull') e.gender = 'Male'
      if (e.location == null && e.event_type !== 'moved' && e.event_type !== 'birth' && e.event_type !== 'purchase') e.location = base.location ?? null

      for (const c of ['location', 'type', 'gender']) {
        if (e[c] != null) continue
        if (c === 'location' && e.event_type === 'moved') error(S, e.source_row, c, 'This is required for a move: it is the pasture the animal moved to.')
        else if (!known) error(S, e.source_row, c, `This is required because tag ${e.tag_number} is new.`)
        else error(S, e.source_row, c, 'This is required.')
      }
      if (e.event_type === 'moved' && known && known.location === e.location) {
        warn(S, e.source_row, 'location', `Tag ${e.tag_number} is already in ${e.location}.`)
      }
      if (e.event_type === 'birth' && e.mother_tag_number && !herd.has(e.mother_tag_number) && !intro.has(e.mother_tag_number)) {
        warn(S, e.source_row, 'mother_tag_number', `Mother ${e.mother_tag_number} is not on file.`)
      }
    }
  }

  function checkTransactionRow(row, v) {
    const S = 'Transactions'
    const before = errors.length
    const out = Object.fromEntries(TRANSACTION_COLUMNS.map((c) => [c, null]))
    out.source_row = row

    for (const c of TRANSACTION_REQUIRED) required(S, row, c, v)

    if (v.transaction_date != null) out.transaction_date = dateField(S, row, 'transaction_date', v.transaction_date, { limits: true })
    if (v.transaction_type != null) out.transaction_type = listField(S, row, 'transaction_type', v.transaction_type, TRANSACTION_TYPES)

    // With no tags listed the row is a shortcut (see above); head count, weight and amounts
    // are worked out where they can be.
    const shortcut = v.tag_numbers == null
    if (v.tag_numbers != null) {
      const parts = String(v.tag_numbers).split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
      const tags = parts.map(parseTag)
      const bad = parts.filter((_, i) => tags[i] === null)
      if (bad.length) error(S, row, 'tag_numbers', `Not valid tag(s): ${bad.join(', ')}.`)
      else if (parts.length === 0) error(S, row, 'tag_numbers', 'Needs at least one tag.')
      else if (new Set(tags).size !== tags.length) error(S, row, 'tag_numbers', 'A tag is listed more than once.')
      else out.tag_numbers = tags
    }

    if (v.head_count != null) {
      const n = parseNumber(v.head_count)
      if (n === null || !Number.isInteger(n) || n < 1) error(S, row, 'head_count', `"${v.head_count}" is not a whole number of 1 or more.`)
      else {
        out.head_count = n
        if (out.tag_numbers && out.tag_numbers.length !== n) error(S, row, 'head_count', `head_count is ${n} but ${out.tag_numbers.length} tag(s) are listed.`)
      }
    }
    for (const [c, min, max] of [
      ['total_weight_lbs', 1, 2_000_000],
      ['price_per_cwt', 0, 5000],
      ['price_per_head', 0, 1_000_000],
      ['total_amount', 0, 10_000_000],
    ]) {
      if (v[c] != null) {
        const n = parseNumber(v[c])
        if (n === null || n < min || n > max) error(S, row, c, `"${v[c]}" is not a number between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}.`)
        else out[c] = n
      }
    }
    if (v.notes != null) {
      if (String(v.notes).length > 500) error(S, row, 'notes', 'Notes are limited to 500 characters.')
      else out.notes = String(v.notes)
    }

    if (shortcut && errors.length === before) {
      if (!eventsReadable) out.tag_numbers = [] // the upload fails on the events anyway; keeps later checks from tripping
      else linkEvents(S, row, out)
    }

    // Each tag needs a matching event in the same file.
    if (errors.length === before && eventsReadable) {
      const wanted = out.transaction_type === 'purchase' ? 'purchase' : 'sold'
      for (const tag of out.tag_numbers) {
        const matches = events.filter((e) => e.tag_number === tag && e.event_type === wanted)
        if (matches.length === 0) {
          error(S, row, 'tag_numbers', `Tag ${tag} has no ${wanted} event on the Events tab.`)
        } else if (!matches.some((e) => e.event_date === out.transaction_date)) {
          warn(S, row, 'tag_numbers', `Tag ${tag}: the ${wanted} event is on ${matches[0].event_date}, not ${out.transaction_date}.`)
        }
      }
    }
    if (errors.length === before && eventsReadable) completeMoney(S, row, out)
    return errors.length === before ? out : null
  }

  // Works out whatever of head_count, total_weight_lbs, total_amount, price_per_head and price_per_cwt
  // was left blank, and checks the ones given against each other.
  function completeMoney(S, row, out) {
    if (out.head_count == null) out.head_count = out.tag_numbers.length
    if (out.total_weight_lbs == null && eventsReadable) {
      const wanted = out.transaction_type === 'purchase' ? 'purchase' : 'sold'
      const linked = out.tag_numbers.map((tag) => events.find((e) => e.tag_number === tag && e.event_type === wanted))
      if (linked.length && linked.every((e) => e && e.weight_lbs != null)) {
        out.total_weight_lbs = linked.reduce((sum, e) => sum + e.weight_lbs, 0)
        info(S, row, 'total_weight_lbs', `No weight was given, so it was added up from the ${linked.length} event weight(s): ${out.total_weight_lbs} lb.`)
      }
    }

    const head = out.head_count
    let total = out.total_amount
    if (total == null && out.price_per_head != null) total = round2(out.price_per_head * head)
    if (total == null && out.total_weight_lbs != null && out.price_per_cwt != null) total = round2((out.total_weight_lbs * out.price_per_cwt) / 100)
    if (total == null) {
      error(S, row, 'total_amount', 'Give a total_amount, a price_per_head, or total_weight_lbs together with price_per_cwt.')
      return
    }
    if (out.price_per_head != null && Math.abs(out.price_per_head * head - total) > 1) {
      error(S, row, 'total_amount', `total_amount should be price_per_head x head_count (${round2(out.price_per_head * head)}), not ${total}.`)
      return
    }
    if (out.total_weight_lbs != null && out.price_per_cwt != null &&
        Math.abs((out.total_weight_lbs * out.price_per_cwt) / 100 - total) > Math.max(5, total * 0.005)) {
      error(S, row, 'total_amount', `total_amount should be total_weight_lbs x price_per_cwt / 100 (${round2((out.total_weight_lbs * out.price_per_cwt) / 100)}), not ${total}.`)
      return
    }
    out.total_amount = total
    if (out.price_per_head == null) out.price_per_head = round2(total / head)
    if (out.price_per_cwt == null && out.total_weight_lbs != null) out.price_per_cwt = round2((total / out.total_weight_lbs) * 100)
  }

  // The shortcut: fill tag_numbers (and later head_count and amounts) from the purchase (or sold)
  // events dated the same day as this transaction. Reports a problem as an error.
  function linkEvents(S, row, out) {
    const wanted = out.transaction_type === 'purchase' ? 'purchase' : 'sold'
    const day = `${wanted}|${out.transaction_date}`
    if (claimedDays.has(day)) {
      error(S, row, 'tag_numbers', `Another row with no tags is already on ${out.transaction_date}, so it is unclear which animals belong to which. List the tags on each row.`)
      return
    }
    claimedDays.add(day)
    const matches = events.filter((e) => e.event_type === wanted && e.event_date === out.transaction_date && !listedTags.has(`${wanted}|${e.tag_number}`))
    if (matches.length === 0) {
      error(S, row, 'tag_numbers', `No tags listed, and there are no ${wanted} events dated ${out.transaction_date} on the Events tab to link to.`)
      return
    }
    const tags = matches.map((e) => e.tag_number)
    const repeated = tags.find((t, i) => tags.indexOf(t) !== i)
    if (repeated) {
      error(S, row, 'tag_numbers', `Tag ${repeated} has two ${wanted} events on ${out.transaction_date}, so list the tags on this row yourself.`)
      return
    }
    if (out.head_count != null && out.head_count !== tags.length) {
      error(S, row, 'head_count', `head_count is ${out.head_count} but ${tags.length} ${wanted} event(s) are dated ${out.transaction_date}.`)
      return
    }
    out.tag_numbers = tags
    out.head_count = tags.length
    info(S, row, 'tag_numbers', `No tags were listed, so they were filled in: this row covers the ${tags.length} ${wanted} event(s) dated ${out.transaction_date} (${tags.join(', ')}).`)
  }

  function checkEventsHaveTransactions() {
    const covered = new Set()
    for (const t of transactions) {
      const wanted = t.transaction_type === 'purchase' ? 'purchase' : 'sold'
      for (const tag of t.tag_numbers) covered.add(`${tag}|${wanted}`)
    }
    for (const e of events) {
      if ((e.event_type === 'purchase' || e.event_type === 'sold') && !covered.has(`${e.tag_number}|${e.event_type}`)) {
        warn('Events', e.source_row, 'event_type', `This ${e.event_type} event has no matching transaction, so it will not show in the Financial dashboard.`)
      }
    }
  }
}
