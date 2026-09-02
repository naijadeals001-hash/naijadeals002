// NaijaDeals — i18n Engine Configuration Constants
//
// Central place for cross-cutting i18n constants that aren't language or
// country DATA (that lives in languages.ts / countries.ts) but govern HOW
// the engine behaves. Kept separate per Section 2's requested file layout.

/** Cookie name used to persist a guest visitor's manually-chosen language. */
export const LANG_COOKIE_NAME = 'nd_lang'

/** Query param a language-selector link/form submits to force a language on this request. */
export const LANG_QUERY_PARAM_NAME = 'lang'

/** Cookie lifetime for the guest language preference (1 year), matching nd_city's precedent. */
export const LANG_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * Whether coming_soon languages should even be *listed* (disabled/greyed)
 * in the selector UI, vs. hidden entirely. TASK N Section 1 wants the
 * architecture to visibly demonstrate continent-wide extensibility, so this
 * defaults to true — see Layout.tsx's language selector markup.
 */
export const SHOW_COMING_SOON_LANGUAGES_IN_SELECTOR = true
