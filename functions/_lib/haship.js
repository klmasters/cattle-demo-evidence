// One-way fingerprint of a visitor's address, for the upload rate limit. The raw address is
// never stored. It is keyed with a server secret so the hash cannot be reversed by trying
// every possible address.

export function makeIpHasher(secret) {
  return async function hashIp(ip) {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret || 'no-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip))
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
  }
}
