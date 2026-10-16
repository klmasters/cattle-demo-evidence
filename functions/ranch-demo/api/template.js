// POST /ranch-demo/api/template: returns the upload template pre-filled with the animals on the ranch.
// NEON_UPLOAD_URL is the same Cloudflare secret the upload uses; this only reads current_cattle.
// TURNSTILE_SECRET_KEY is the secret half of the Turnstile widget (the bot check).

import { Pool } from '@neondatabase/serverless'
import { handleTemplate } from '../../_lib/template.js'
import { makeVerifier } from '../../_lib/turnstile.js'

export async function onRequest({ request, env }) {
  return handleTemplate(request, {
    verifyHuman: makeVerifier(env.TURNSTILE_SECRET_KEY),
    // The blank template is a static file in the site; read it from the site's own assets.
    async loadTemplate() {
      const response = await env.ASSETS.fetch(new URL('/cattle_upload_template.xlsx', request.url))
      if (!response.ok) throw new Error(`blank template: status ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    async withClient(fn) {
      const pool = new Pool({ connectionString: env.NEON_UPLOAD_URL })
      const client = await pool.connect()
      try {
        return await fn(client)
      } finally {
        client.release()
        await pool.end()
      }
    },
  })
}
