// Upload of one animal's history file (the download from the Animal Lookup page). The file holds
// the animal's saved events, each with its row_id, and any new rows the visitor added with a blank
// row_id. Only the new rows are saved. This file separates the two kinds.

const SAME_AS_STORED = ['event_date', 'event_type', 'location', 'type', 'gender', 'birth_year', 'mother_tag_number', 'date_bought', 'weight_lbs', 'estimated_months_pregnant', 'notes']

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

// Writes a cell the way the database does, so "1013", 1013 and "1013.0" compare equal and a date
// cell compares equal to its stored YYYY-MM-DD.
function normalize(value) {
  if (blank(value)) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') return String(value)
  const text = String(value).trim()
  return /^-?\d+\.0+$/.test(text) ? text.replace(/\.0+$/, '') : text
}

/**
 * @param {{headers: string[], rows: {row: number, values: object}[]}} sheet  the Events tab
 * @param {Map<string, object>} saved  row_id -> the stored event, for the row_ids in the file
 * @param {string} animalTag
 * @returns {{ rows, errors, warnings, skipped }}  rows: the new rows only
 */
export function separateSavedRows(sheet, saved, animalTag) {
  const errors = []
  const warnings = []
  const rows = []
  let skipped = 0
  for (const r of sheet.rows) {
    const id = blank(r.values.row_id) ? null : String(r.values.row_id).trim()
    if (id === null) {
      rows.push(r)
      continue
    }
    const stored = saved.get(id)
    if (!stored) {
      errors.push({ sheet: 'Events', row: r.row, column: 'row_id', message: 'This row_id is not on file. Delete the row, or clear row_id to add it as a new event.' })
    } else if (stored.tag_number !== animalTag) {
      errors.push({ sheet: 'Events', row: r.row, column: 'row_id', message: `This saved event belongs to tag ${stored.tag_number}, not tag ${animalTag}.` })
    } else {
      skipped++
      if (SAME_AS_STORED.some((c) => normalize(r.values[c]) !== normalize(stored[c])) || normalize(r.values.tag_number) !== normalize(stored.tag_number)) {
        warnings.push({ sheet: 'Events', row: r.row, column: null, message: 'This saved event was changed in the file. Saved events cannot be edited, so the change was ignored.' })
      }
    }
  }
  return { rows, errors, warnings, skipped }
}
