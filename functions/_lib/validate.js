// Validates an uploaded cattle spreadsheet. Pure JavaScript with no database or
// network access, so it runs the same in Cloudflare and in local tests.
//
// Input: sheets built by parse.js. A "sheet" is { headers: [...], rows: [{ row, values }] }
// where `row` is the spreadsheet row number and `values` maps column name -> cell value.
//
// Output: { ok, errors, warnings, events, transactions, counts }. Any error means the
// whole upload is rejected (all or nothing); warnings let it through.

export const EVENT_TYPES = ['birth', 'purchase', 'weight', 'vaccination', 'pregnant', 'sold', 'deceased']
export const ANIMAL_TYPES = ['Cow', 'Bull', 'Calf']
export const LOCATIONS = ['Ranch', 'Eureka']
export const BREEDS = ['Black Angus', 'Red Angus', 'Sim Angus']
export const TRANSACTION_TYPES = ['purchase', 'sale']

export const MAX_ROWS = 500
const MAX_MESSAGES = 50
export const MIN_DATE = '2000-01-01'

export const EVENT_COLUMNS = [
  'tag_number', 'event_date', 'event_type', 'location', 'breed', 'type', 'weight_lbs', 'notes',
  'mother_tag_number', 'previous_tag_number', 'birth_year',
  'estimated_preg_date', 'estimated_months_pregnant', 'estimated_due_month',
]
const EVENT_REQUIRED = ['tag_number', 'event_date', 'event_type', 'location', 'breed', 'type']
export const TRANSACTION_COLUMNS = [
  'transaction_date', 'transaction_type', 'tag_numbers', 'head_count', 'price_per_head', 'total_amount', 'notes',
]
const TRANSACTION_REQUIRED = ['transaction_date', 'transaction_type', 'tag_numbers', 'head_count', 'price_per_head', 'total_amount']

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

// ---- main ----------------------------------------------------------------------

/**
 * @param {{events: Sheet|null, transactions: Sheet|null}} sheets
 * @param {{today?: string, herd?: Map<string, {status: string, lastEventDate: string}>}} [options]
 *   today: 'YYYY-MM-DD' (tests set it). herd: snapshot of the live herd, used for the
 *   checks that need the database (step 2c); without it only in-file checks run.
 */
export function validate(sheets, options = {}) {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const maxDate = addDays(today, 1)
  const thisYear = Number(today.slice(0, 4))
  const herd = options.herd ?? null

  const errors = []
  const warnings = []
  const error = (sheet, row, column, message) => errors.push({ sheet, row, column, message })
  const warn = (sheet, row, column, message) => warnings.push({ sheet, row, column, message })

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
      errors: errors.slice(0, MAX_MESSAGES),
      errorCount: errors.length,
      warnings: warnings.slice(0, MAX_MESSAGES),
      warningCount: warnings.length,
      events: errors.length ? [] : events,
      transactions: errors.length ? [] : transactions,
      counts: { events: events.length, transactions: transactions.length },
    }
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
    const out = Object.fromEntries(EVENT_COLUMNS.map((c) => [c, null]))
    out.source_row = row

    for (const c of EVENT_REQUIRED) required(S, row, c, v)

    if (v.tag_number != null) {
      out.tag_number = parseTag(v.tag_number)
      if (!out.tag_number) error(S, row, 'tag_number', `"${v.tag_number}" is not a valid tag (letters, digits and hyphens, up to 20 characters).`)
    }
    if (v.event_date != null) out.event_date = dateField(S, row, 'event_date', v.event_date, { limits: true })
    if (v.event_type != null) out.event_type = listField(S, row, 'event_type', v.event_type, EVENT_TYPES)
    if (v.location != null) out.location = listField(S, row, 'location', v.location, LOCATIONS)
    if (v.breed != null) out.breed = listField(S, row, 'breed', v.breed, BREEDS)
    if (v.type != null) out.type = listField(S, row, 'type', v.type, ANIMAL_TYPES)

    if (v.weight_lbs != null) {
      const w = parseNumber(v.weight_lbs)
      if (w === null || w <= 0 || w > 3000) error(S, row, 'weight_lbs', `"${v.weight_lbs}" is not a weight between 0 and 3000 lb.`)
      else out.weight_lbs = w
    } else if (out.event_type === 'weight') {
      error(S, row, 'weight_lbs', 'A weight event needs a weight.')
    }

    if (v.birth_year != null) {
      const y = parseNumber(v.birth_year)
      if (y === null || !Number.isInteger(y) || y < 1980 || y > thisYear) error(S, row, 'birth_year', `"${v.birth_year}" is not a year between 1980 and ${thisYear}.`)
      else out.birth_year = y
    }
    if (v.estimated_months_pregnant != null) {
      const n = parseNumber(v.estimated_months_pregnant)
      if (n === null || !Number.isInteger(n) || n < 0 || n > 10) error(S, row, 'estimated_months_pregnant', `"${v.estimated_months_pregnant}" is not a whole number of months between 0 and 10.`)
      else out.estimated_months_pregnant = n
    }
    for (const c of ['estimated_preg_date', 'estimated_due_month']) {
      if (v[c] != null) out[c] = dateField(S, row, c, v[c], { limits: false })
    }
    for (const c of ['mother_tag_number', 'previous_tag_number']) {
      if (v[c] != null) {
        out[c] = parseTag(v[c])
        if (!out[c]) error(S, row, c, `"${v[c]}" is not a valid tag.`)
      }
    }
    if (v.notes != null) {
      const notes = String(v.notes)
      if (notes.length > 500) error(S, row, 'notes', `Notes are ${notes.length} characters; the limit is 500.`)
      else out.notes = notes
    }

    if (out.event_type === 'birth' && v.mother_tag_number == null) warn(S, row, 'mother_tag_number', 'A birth event usually has the mother\'s tag.')
    if (out.event_type === 'pregnant' && v.estimated_due_month == null) warn(S, row, 'estimated_due_month', 'A pregnant event usually has an estimated due month; it will not show on the due-date chart without one.')

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
    // Same tag with different breed or type in different rows.
    const traits = new Map()
    for (const e of events) {
      const prior = traits.get(e.tag_number)
      if (!prior) traits.set(e.tag_number, { breed: e.breed, type: e.type, row: e.source_row, warned: false })
      else if (!prior.warned && (prior.breed !== e.breed || prior.type !== e.type)) {
        prior.warned = true
        warn(S, e.source_row, 'breed', `Tag ${e.tag_number} has a different breed or type than on row ${prior.row}.`)
      }
    }
    // Checks against the live herd (step 2c supplies the snapshot).
    if (herd) {
      for (const e of events) {
        const known = herd.get(e.tag_number)
        if (!known) continue
        if ((known.status === 'sold' || known.status === 'deceased') && e.event_date > known.lastEventDate) {
          error(S, e.source_row, 'tag_number', `Tag ${e.tag_number} is already recorded as ${known.status} (${known.lastEventDate}).`)
        } else if (known.status === 'active' && e.event_type === 'purchase') {
          warn(S, e.source_row, 'event_type', `Tag ${e.tag_number} is already on the ranch, so a purchase is unusual.`)
        }
      }
    }
  }

  function checkTransactionRow(row, v) {
    const S = 'Transactions'
    const before = errors.length
    const out = { source_row: row, notes: null }

    // With no tags listed the row is a shortcut (see above): head_count and total_amount may be
    // blank too, and are worked out. A row that lists its tags follows the original rules.
    const shortcut = v.tag_numbers == null
    for (const c of TRANSACTION_REQUIRED) {
      if (shortcut && (c === 'tag_numbers' || c === 'head_count' || c === 'total_amount')) continue
      required(S, row, c, v)
    }

    if (v.transaction_date != null) out.transaction_date = dateField(S, row, 'transaction_date', v.transaction_date, { limits: true })
    if (v.transaction_type != null) out.transaction_type = listField(S, row, 'transaction_type', v.transaction_type, TRANSACTION_TYPES)

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
    for (const [c, max] of [['price_per_head', 1_000_000], ['total_amount', 10_000_000]]) {
      if (v[c] != null) {
        const n = parseNumber(v[c])
        if (n === null || n < 0 || n > max) error(S, row, c, `"${v[c]}" is not a dollar amount between 0 and ${max.toLocaleString('en-US')}.`)
        else out[c] = n
      }
    }
    if (shortcut) {
      if (!eventsReadable) {
        out.tag_numbers = [] // the upload fails on the events anyway; keeps later checks from tripping
      } else if (errors.length === before) {
        linkEvents(S, row, out)
      }
    }
    if (out.price_per_head != null && out.total_amount != null && out.head_count != null &&
        Math.abs(out.price_per_head * out.head_count - out.total_amount) > 1) {
      error(S, row, 'total_amount', `total_amount should be price_per_head x head_count (${out.price_per_head * out.head_count}), not ${out.total_amount}.`)
    }
    if (v.notes != null) {
      if (String(v.notes).length > 500) error(S, row, 'notes', 'Notes are limited to 500 characters.')
      else out.notes = String(v.notes)
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
    return errors.length === before ? out : null
  }

  // The shortcut: fill tag_numbers, head_count and total_amount from the purchase (or sold) events
  // dated the same day as this transaction. Adds to `out`; reports a problem as an error.
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
    if (out.total_amount == null) out.total_amount = Math.round(out.price_per_head * tags.length * 100) / 100
    warn(S, row, 'tag_numbers', `No tags were listed, so this row covers the ${tags.length} ${wanted} event(s) dated ${out.transaction_date}: ${tags.join(', ')}.`)
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
