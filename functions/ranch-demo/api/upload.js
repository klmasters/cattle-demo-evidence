// POST /ranch-demo/api/upload: the endpoint the upload page calls.
// NEON_UPLOAD_URL is a Cloudflare secret holding the ranch_uploader connection string.

import { Pool } from '@neondatabase/serverless'
import { handleUpload } from '../../_lib/handle.js'

export async function onRequest({ request, env }) {
  return handleUpload(request, {
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
