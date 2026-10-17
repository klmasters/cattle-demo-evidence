// The upload request, start to finish, with the database passed in so it can be tested.

import { validate } from './validate.js'
import { contentHash, loadHerd, loadSavedEvents, recentUploads, saveUpload } from './save.js'
import { separateSavedRows } from './animal-upload.js'
import { sheetsFromForm, UploadError } from './source.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/**
 * @param {Request} request
 * @param {{ withClient: (fn: (client) => Promise<any>) => Promise<any>, fetch?: typeof fetch,
 *           verifyHuman?: (token: string, ip: string | null) => Promise<boolean>,
 *           hashIp?: (ip: string) => Promise<string>,
 *           onSaved?: () => void }} deps
 */
export const UPLOADS_PER_HOUR = 5

export async function handleUpload(request, { withClient, fetch: fetchFn = fetch, verifyHuman, hashIp, onSaved }) {
  if (request.method !== 'POST') return json({ ok: false, message: 'Use POST.' }, 405)
  if (Number(request.headers.get('content-length') ?? 0) > 3 * 1024 * 1024) {
    return json({ ok: false, message: 'The upload is too large.' }, 413)
  }

  try {
    let form
    try {
      form = await request.formData()
    } catch {
      return json({ ok: false, message: 'Could not read the upload.' }, 400)
    }
    // Bot check first, before any file is read. The live endpoint always supplies verifyHuman.
    if (verifyHuman) {
      const token = form.get('cf-turnstile-response')
      const ip = request.headers.get('cf-connecting-ip')
      if (!(await verifyHuman(typeof token === 'string' ? token : '', ip))) {
        return json({ ok: false, message: 'The "are you a person" check did not pass. Reload the page and try again.' }, 403)
      }
    }
    // Rate limit: a few saved uploads per hour per visitor. Only a hash of the address is stored.
    const ip = request.headers.get('cf-connecting-ip')
    const uploader = hashIp && ip ? await hashIp(ip) : null
    if (uploader) {
      const recent = await withClient((client) => recentUploads(client, uploader))
      if (recent >= UPLOADS_PER_HOUR) {
        return json({ ok: false, message: `Upload limit reached (${UPLOADS_PER_HOUR} per hour). Please try again later.` }, 429)
      }
    }
    // An animal's history file comes with the tag of the animal being looked at. Only that animal's
    // new rows are saved; the rows that are already saved (they carry a row_id) are skipped.
    const rawTag = form.get('animal_tag')
    const animalTag = typeof rawTag === 'string' && rawTag.trim() !== '' ? rawTag.trim() : null
    if (animalTag !== null && !/^[A-Za-z0-9-]{1,20}$/.test(animalTag)) {
      return json({ ok: false, message: 'That is not a valid tag number.' }, 400)
    }

    let { sheets, filename } = await sheetsFromForm(form, fetchFn)
    const extraWarnings = []
    const extraInfos = []
    if (animalTag !== null && sheets.events) {
      const ids = [...new Set(sheets.events.rows.map((r) => r.values.row_id).filter((v) => v != null && String(v).trim() !== '').map((v) => String(v).trim()))]
      const saved = await withClient((client) => loadSavedEvents(client, ids))
      const split = separateSavedRows(sheets.events, saved, animalTag)
      const newRows = split.rows.filter((r) => Object.values(r.values).some((v) => v != null && String(v).trim() !== ''))
      if (split.errors.length || newRows.length === 0) {
        const errors = split.errors.length ? split.errors
          : [{ sheet: 'Events', row: null, column: null, message: 'No new rows found. Add a row under the last event, leave row_id blank, and upload again.' }]
        return json({ ok: false, message: 'Nothing was saved. Fix the problems below and upload again.', errors, errorCount: errors.length, warnings: split.warnings, warningCount: split.warnings.length, infos: [], infoCount: 0, counts: { events: 0, transactions: 0 } }, 422)
      }
      sheets = { ...sheets, events: { ...sheets.events, rows: newRows } }
      extraWarnings.push(...split.warnings)
      if (split.skipped) extraInfos.push({ sheet: 'Events', row: null, column: null, message: `${split.skipped} saved event${split.skipped === 1 ? '' : 's'} in the file ${split.skipped === 1 ? 'was' : 'were'} skipped. Only new rows are saved.` })
    }

    // First pass without the database: catches everything wrong inside the file.
    const options = animalTag !== null ? { onlyTag: animalTag } : {}
    let result = validate(sheets, options)
    if (result.ok) {
      // Second pass with the live herd, for problems that depend on what is stored.
      const tags = [...new Set(result.events.flatMap((e) => [e.tag_number, e.mother_tag_number].filter(Boolean)))]
      const herd = await withClient((client) => loadHerd(client, tags))
      result = validate(sheets, { ...options, herd })
    }
    const report = {
      errors: result.errors, errorCount: result.errorCount,
      warnings: [...extraWarnings, ...result.warnings], warningCount: extraWarnings.length + result.warningCount,
      infos: [...extraInfos, ...result.infos], infoCount: extraInfos.length + result.infoCount,
      counts: result.counts,
    }
    if (!result.ok) {
      return json({ ok: false, message: 'Nothing was saved. Fix the problems below and upload again.', ...report }, 422)
    }

    const hash = await contentHash(result.events, result.transactions)
    const saved = await withClient((client) =>
      saveUpload(client, { filename, hash, events: result.events, transactions: result.transactions, uploader }))
    if (saved.duplicate) {
      return json({ ok: false, message: 'This exact data was already uploaded, so nothing new was saved.', ...report }, 409)
    }
    // Tell the site to rebuild. Whatever happens here must never turn a saved upload into an error.
    try { onSaved?.() } catch (err) { console.error('rebuild trigger failed', err?.message) }
    return json({ ok: true, message: 'Saved. The dashboards update within about 2 to 3 minutes.', batchId: saved.batchId, ...report })
  } catch (err) {
    if (err instanceof UploadError || /^(The file|Could not read the file)/.test(err?.message ?? '')) {
      return json({ ok: false, message: err.message }, 400)
    }
    console.error('upload failed', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Nothing was saved.' }, 500)
  }
}
