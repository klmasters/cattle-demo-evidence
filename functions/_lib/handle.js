// The upload request, start to finish, with the database passed in so it can be tested.

import { validate } from './validate.js'
import { contentHash, loadHerd, recentUploads, saveUpload } from './save.js'
import { sheetsFromForm, UploadError } from './source.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/**
 * @param {Request} request
 * @param {{ withClient: (fn: (client) => Promise<any>) => Promise<any>, fetch?: typeof fetch,
 *           verifyHuman?: (token: string, ip: string | null) => Promise<boolean>,
 *           hashIp?: (ip: string) => Promise<string> }} deps
 */
export const UPLOADS_PER_HOUR = 5

export async function handleUpload(request, { withClient, fetch: fetchFn = fetch, verifyHuman, hashIp }) {
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
    const { sheets, filename } = await sheetsFromForm(form, fetchFn)

    // First pass without the database: catches everything wrong inside the file.
    let result = validate(sheets)
    if (result.ok) {
      // Second pass with the live herd, for problems that depend on what is stored.
      const tags = [...new Set(result.events.map((e) => e.tag_number))]
      const herd = await withClient((client) => loadHerd(client, tags))
      result = validate(sheets, { herd })
    }
    const report = {
      errors: result.errors, errorCount: result.errorCount,
      warnings: result.warnings, warningCount: result.warningCount,
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
    return json({ ok: true, message: 'Saved. The dashboards update within about 15 minutes.', batchId: saved.batchId, ...report })
  } catch (err) {
    if (err instanceof UploadError || /^(The file|Could not read the file)/.test(err?.message ?? '')) {
      return json({ ok: false, message: err.message }, 400)
    }
    console.error('upload failed', err?.message)
    return json({ ok: false, message: 'Something went wrong on our side. Nothing was saved.' }, 500)
  }
}
