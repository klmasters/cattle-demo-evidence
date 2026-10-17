// POST /ranch-demo/api/animal-history: one animal's full event history as an .xlsx.
// Uses the same Cloudflare secrets as the template download: NEON_UPLOAD_URL (read-only use here)
// and TURNSTILE_SECRET_KEY.

import { Pool } from '@neondatabase/serverless'
import { handleAnimalHistory } from '../../_lib/animal-history.js'
import { makeVerifier } from '../../_lib/turnstile.js'

export async function onRequest({ request, env }) {
  return handleAnimalHistory(request, {
    verifyHuman: makeVerifier(env.TURNSTILE_SECRET_KEY),
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
