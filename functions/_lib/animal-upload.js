// Upload of one animal's history file (the download from the Animal Lookup page). The file holds
// the animal's saved events, each with its row_id, and any new rows the visitor added with a blank
// row_id. Only the new rows are saved. This file separates the two kinds.

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/**
 * @param {{headers: string[], rows: {row: number, values: object}[]}} sheet  the Events tab
 * @param {Map<string, object>} saved  row_id -> the stored event, for the row_ids in the file
 * @param {string} animalTag
 * @returns {{ rows, errors, skipped }}  rows: the new rows only. A saved row is skipped as it is. A change
 *   made to it in the file is ignored without a warning: comparing would flag unchanged rows too, because
 *   spreadsheet programs rewrite dates and numbers when they save a file.
 */
export function separateSavedRows(sheet, saved, animalTag) {
  const errors = []
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
    }
  }
  return { rows, errors, skipped }
}
