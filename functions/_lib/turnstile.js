// Checks a Cloudflare Turnstile token ("is this a person?") with Cloudflare's verify service.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Returns a function (token, ip) => Promise<boolean> that checks tokens with the given secret. */
export function makeVerifier(secret, fetchFn = fetch) {
  return async function verifyHuman(token, ip) {
    if (!secret || !token) return false
    const body = new FormData()
    body.append('secret', secret)
    body.append('response', String(token))
    if (ip) body.append('remoteip', ip)
    try {
      const response = await fetchFn(VERIFY_URL, { method: 'POST', body })
      const result = await response.json()
      return result.success === true
    } catch {
      return false // if Cloudflare cannot be reached, nobody gets in
    }
  }
}
