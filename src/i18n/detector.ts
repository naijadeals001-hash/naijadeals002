// NaijaDeals — Language Detection (Priority Chain)
//
// Implements TASK N Section 2/3's exact priority order:
//   1. Explicit user selection (this request's ?lang= query param — the
//      language selector always submits via a real navigation, never JS-only
//      state, so page reloads / no-JS clients still work)
//   2. Previously saved preference — logged-in user's `users.preferred_language`
//      column (if signed in), else the `nd_lang` cookie (guest)
//   3. Browser Accept-Language header
//   4. Country/IP signal — Cloudflare's `request.cf.country` (NEVER the raw
//      IP itself — Cloudflare resolves this server-side; we never see or
//      store an IP address anywhere in this codebase)
//   5. Site default: English
//
// Section 4's anti-pattern warning is enforced structurally, not just by
// convention: getCountrySuggestedLanguage() (countries.ts) always returns
// 'en' unless the country's own configured default is itself a LIVE
// language, and even then it is only ever consulted at priority level 4 —
// after explicit selection, saved preference, and browser language have all
// had a chance to override it. A Nigerian visitor is never locked into any
// non-English language purely by virtue of their IP.

import type { Context } from 'hono'
import { isLiveLanguage, DEFAULT_LANGUAGE } from './languages'
import type { LanguageCode } from './languages'
import { getCountrySuggestedLanguage } from './countries'
import type { LocaleContext } from './types'

export const LANG_COOKIE = 'nd_lang'
export const LANG_QUERY_PARAM = 'lang'

/** Very small Accept-Language parser: "fr-FR,fr;q=0.9,en;q=0.8" -> ['fr','en']. */
function parseAcceptLanguage(header: string | null | undefined): LanguageCode[] {
  if (!header) return []
  return header
    .split(',')
    .map((part) => {
      const [tag] = part.trim().split(';')
      // Take the primary subtag: "fr-FR" -> "fr", "pt-BR" -> "pt"
      return tag.split('-')[0].toLowerCase()
    })
    .filter((code): code is LanguageCode => isLiveLanguage(code))
}

/** Reads Cloudflare's resolved country code. Never touches a raw IP address. */
function getCloudflareCountry(c: Context): string | null {
  const cf = (c.req.raw as any).cf as { country?: string } | undefined
  return cf?.country ?? null
}

function readCookie(c: Context, name: string): string | null {
  const header = c.req.header('cookie') ?? ''
  const match = header.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

export interface DetectLanguageInput {
  /** Explicit ?lang= query value on THIS request, if present. */
  explicitQueryLang?: string | null
  /** Signed-in user's saved preference (users.preferred_language), if any. */
  userSavedLang?: string | null
}

/**
 * Resolves the language + how it was resolved, following the exact 5-step
 * priority chain. Pure function over explicit inputs + the request, so it's
 * trivially unit-testable (see src/i18n/detector.test — logic asserted via
 * scripts/i18n_test.cjs, since this repo has no Vitest/Jest runner wired).
 */
export function detectLanguage(c: Context, input: DetectLanguageInput = {}): LocaleContext {
  const countryCode = getCloudflareCountry(c)

  // 1. Explicit selection on this request
  if (isLiveLanguage(input.explicitQueryLang)) {
    return build(input.explicitQueryLang, 'manual', countryCode)
  }

  // 2a. Logged-in saved preference
  if (isLiveLanguage(input.userSavedLang)) {
    return build(input.userSavedLang, 'saved', countryCode)
  }

  // 2b. Guest cookie preference (only trusted as "manual" if the cookie
  // itself was set by a manual choice — see api-i18n.ts which is the only
  // writer of this cookie, always in response to an explicit selector click)
  const cookieLang = readCookie(c, LANG_COOKIE)
  if (isLiveLanguage(cookieLang)) {
    return build(cookieLang, 'saved', countryCode)
  }

  // 3. Browser Accept-Language
  const acceptLangs = parseAcceptLanguage(c.req.header('accept-language'))
  if (acceptLangs.length > 0) {
    return build(acceptLangs[0], 'browser', countryCode)
  }

  // 4. Country/IP-derived suggestion (never a lock — see file header)
  if (countryCode) {
    const suggested = getCountrySuggestedLanguage(countryCode)
    if (suggested !== DEFAULT_LANGUAGE) {
      return build(suggested, 'country', countryCode)
    }
  }

  // 5. English fallback
  return build(DEFAULT_LANGUAGE, 'default', countryCode)
}

function build(language: LanguageCode, source: LocaleContext['source'], countryCode: string | null): LocaleContext {
  const dir = language === 'ar' ? 'rtl' : 'ltr'
  return { language, source, countryCode, dir }
}
