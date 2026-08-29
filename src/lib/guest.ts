import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

const GUEST_COOKIE = 'nd_guest'

function randomToken(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Returns the existing guest-cart token from the cookie, or issues a new one. */
export function getOrSetGuestToken(c: Context): string {
  let token = getCookie(c, GUEST_COOKIE)
  if (!token) {
    token = randomToken()
    setCookie(c, GUEST_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 90
    })
  }
  return token
}
