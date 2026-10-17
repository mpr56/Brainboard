/**
 * First-party cookies, set from script. There is no server, so these are never
 * HttpOnly — they are a session pointer, not a credential.
 */

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (decodeURIComponent(part.slice(0, eq).trim()) === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

export function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie =
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}` +
    `; Max-Age=${Math.round(maxAgeSeconds)}; Path=/; SameSite=Lax${secure}`
}

export function clearCookie(name: string): void {
  writeCookie(name, '', 0)
}
