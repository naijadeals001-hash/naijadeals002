// NaijaDeals — Translation Dictionary Registry
//
// Maps every LIVE language code to its populated TranslationDict. This is
// the ONE place a new live dictionary gets registered — adding a language
// later means: (1) write src/i18n/translations/<code>.ts, (2) add one line
// here, (3) flip its `status` to 'live' in languages.ts. No other file in
// the app needs to change (see docs/I18N.md "how to add a language").

import type { LanguageCode } from '../languages'
import type { TranslationDict } from '../types'
import { en } from './en'
import { pcm } from './pcm'
import { ig } from './ig'
import { yo } from './yo'
import { ha } from './ha'
import { tw } from './tw'
import { sw } from './sw'
import { fr } from './fr'
import { pt } from './pt'
import { ar } from './ar'

export const DICTIONARIES: Partial<Record<LanguageCode, TranslationDict>> = {
  en, pcm, ig, yo, ha, tw, sw, fr, pt, ar,
}

/**
 * Returns the dictionary for `code`, or the English dictionary if `code`
 * has no populated dictionary (coming_soon languages, or any unexpected
 * value) — this is the hard backstop that guarantees the app NEVER renders
 * `undefined` or a missing-translation artifact, per Section 9.
 */
export function getDictionary(code: LanguageCode): TranslationDict {
  return DICTIONARIES[code] ?? en
}
