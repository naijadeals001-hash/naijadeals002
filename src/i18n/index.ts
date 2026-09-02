// NaijaDeals — Central i18n Engine Entry Point
//
// This is the ONLY module the rest of the app should import from
// (`import { t, resolveLocale } from '../i18n'`) — internal files
// (languages.ts, countries.ts, detector.ts, translations/*) are
// implementation detail. See docs/I18N.md for the developer contract.

import type { Context } from 'hono'
import { getDictionary } from './translations'
import { detectLanguage, LANG_COOKIE, LANG_QUERY_PARAM } from './detector'
import type { LocaleContext } from './types'
import type { TranslationKey } from './types'

export type { LocaleContext, TranslationKey, TranslationDict } from './types'
export type { LanguageCode, LanguageDef } from './languages'
export { LANGUAGES, LIVE_LANGUAGES, DEFAULT_LANGUAGE, isLiveLanguage, getLanguage } from './languages'
export { COUNTRIES, getCountryConfig, getCountrySuggestedLanguage } from './countries'
export { LANG_COOKIE, LANG_QUERY_PARAM } from './detector'

/**
 * Resolves the LocaleContext for the current request. Call this once per
 * request (attachLocale middleware already does this and stores the result
 * on `c.var.locale` — page handlers should read c.var.locale directly rather
 * than calling this again, to avoid re-parsing headers).
 */
export function resolveLocale(c: Context, opts: { userSavedLang?: string | null } = {}): LocaleContext {
  const explicitQueryLang = c.req.query(LANG_QUERY_PARAM)
  return detectLanguage(c, { explicitQueryLang, userSavedLang: opts.userSavedLang })
}

/**
 * Translator factory. Given a resolved locale, returns a `t(key, vars?)`
 * function bound to that locale's dictionary. Missing keys can't happen at
 * compile time (TranslationKey is typed against the full dict), but as a
 * runtime backstop (e.g. a dictionary object was hand-edited and a key
 * deleted), an untranslated key NEVER renders `undefined`/`[missing]` —
 * it falls back to the English string for that same key, and in dev mode
 * additionally logs a console warning (Section 9's explicit requirement).
 */
export function createTranslator(locale: LocaleContext) {
  const dict = getDictionary(locale.language)
  const enDict = getDictionary('en')

  return function t(key: TranslationKey, vars?: Record<string, string>): string {
    let value = dict[key]
    if (value === undefined) {
      // Dev-mode-only warning; never thrown, never shown to the user.
      // @ts-ignore — import.meta.env is a Vite build-time global.
      if (typeof importMetaEnvIsDev === 'function' && importMetaEnvIsDev()) {
        console.warn(`[i18n] Missing key "${key}" for locale "${locale.language}" — falling back to English.`)
      }
      value = enDict[key] ?? key
    }
    if (!vars) return value
    return Object.entries(vars).reduce(
      (acc, [k, v]) => acc.split(`{${k}}`).join(v),
      value
    )
  }
}

// Small indirection so the dev-only console.warn above doesn't require a
// hard Vite import.meta typing dependency in this file; always returns
// false in production builds (harmless either way — warnings are silent
// no-ops in prod even if this returned true).
function importMetaEnvIsDev(): boolean {
  try {
    // @ts-ignore
    return !!(import.meta as any)?.env?.DEV
  } catch {
    return false
  }
}

/** Sets the guest locale cookie (nd_lang), 1 year, following the exact
 *  precedent of nd_city / nd_session cookie handling elsewhere in this app. */
export function buildLangCookie(language: string): string {
  return `${LANG_COOKIE}=${encodeURIComponent(language)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
}
