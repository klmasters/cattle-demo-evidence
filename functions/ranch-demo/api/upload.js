// POST /ranch-demo/api/upload: the endpoint the upload page calls.
// NEON_UPLOAD_URL is a Cloudflare secret holding the ranch_uploader connection string.
// TURNSTILE_SECRET_KEY is the secret half of the Turnstile widget (the bot check).

import { Pool } from '@neondatabase/serverless'
import { handleUpload } from '../../_lib/handle.js'
import { makeVerifier } from '../../_lib/turnstile.js'
import { makeIpHasher } from '../../_lib/haship.js'

export async function onRequest({ request, env }) {
  return handleUpload(request, {
    verifyHuman: makeVerifier(env.TURNSTILE_SECRET_KEY),
    hashIp: makeIpHasher(env.TURNSTILE_SECRET_KEY), // keyed with the same secret; only the hash is stored
    async withClient(fn) {
      const pool = new Pool({ connectionString: env.NEON_UPLOAD_URL })
      const client = await pool.connect()
      try {
        return await fn(client)
      } catch (err) {
        // For debugging permission problems: log which database role we are connected as.
        const who = await client.query('select current_user as role').catch(() => null)
        console.error('database role:', who?.rows?.[0]?.role)
        throw err
      } finally {
        client.release()
        await pool.end()
      }
    },
  })
}
