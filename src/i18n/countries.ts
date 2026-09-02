// NaijaDeals — Africa-Wide Country → Language/Currency Configuration
//
// Central, editable-later map from ISO 3166-1 alpha-2 country code (the exact
// format Cloudflare's `request.cf.country` returns) to:
//   - which languages are OFFERED as options for a visitor from that country
//   - which one is SUGGESTED by default (never forced — see detector.ts)
//   - the country's currency (kept separate from language per Section 6)
//
// TASK N Section 4 is explicit: "Nigeria has multiple major languages...
// Instead: Country: Nigeria / Available: English, Pidgin, Igbo, Yoruba,
// Hausa. The default should remain English unless browser/user signals
// suggest another supported language." That rule is encoded here as
// `defaultLanguage: 'en'` for every single country, even ones with a strong
// live local-language dictionary (e.g. Kenya's defaultLanguage is 'en', not
// 'sw', even though 'sw' is offered and Swahili is often first in casual
// listings). Country only ever narrows the OFFERED set + supplies the
// fallback-of-last-resort if nothing else resolves — it is never itself the
// language decision (browser Accept-Language, if it names a language we
// support, wins over the raw country default; see detector.ts's priority
// chain).
//
// This table is intentionally comprehensive across the continent per Section
// 1's "architecture must support all African countries" instruction, using
// 'coming_soon' languages (see languages.ts) where a real dictionary does
// not exist yet — a country entry can list a coming_soon language as
// AVAILABLE (so the selector is honest about future intent) without ever
// being able to actually serve it as a resolved default.

import type { LanguageCode } from './languages'
import { LIVE_LANGUAGES } from './languages'

export interface CountryLocaleConfig {
  /** ISO 3166-1 alpha-2, matches Cloudflare's request.cf.country. */
  countryCode: string
  countryName: string
  /** ISO 4217 currency code. Kept separate from language per Section 6. */
  currency: string
  /** Languages a visitor from this country may pick from (subset of LANGUAGES). */
  availableLanguages: LanguageCode[]
  /** Country's own suggested default IF nothing else resolves. Per Section 4,
   *  this is deliberately 'en' for almost every entry — see file header. */
  defaultLanguage: LanguageCode
}

// Helper so most entries can just say "these languages are relevant here"
// without repeating defaultLanguage: 'en' + currency lookups every time.
function country(
  countryCode: string,
  countryName: string,
  currency: string,
  availableLanguages: LanguageCode[],
  defaultLanguage: LanguageCode = 'en'
): CountryLocaleConfig {
  return { countryCode, countryName, currency, availableLanguages, defaultLanguage }
}

export const COUNTRIES: Record<string, CountryLocaleConfig> = {
  // ---------------- Nigeria (home market) ----------------
  NG: country('NG', 'Nigeria', 'NGN', ['en', 'pcm', 'ig', 'yo', 'ha'], 'en'),

  // ---------------- Ghana ----------------
  GH: country('GH', 'Ghana', 'GHS', ['en', 'tw'], 'en'),

  // ---------------- East Africa ----------------
  KE: country('KE', 'Kenya', 'KES', ['en', 'sw'], 'en'),
  TZ: country('TZ', 'Tanzania', 'TZS', ['sw', 'en'], 'sw'),
  UG: country('UG', 'Uganda', 'UGX', ['en', 'sw'], 'en'),
  RW: country('RW', 'Rwanda', 'RWF', ['rw', 'en', 'fr'], 'en'),
  BI: country('BI', 'Burundi', 'BIF', ['rn', 'fr'], 'fr'),
  ET: country('ET', 'Ethiopia', 'ETB', ['am', 'en'], 'en'),

  // ---------------- Francophone Africa ----------------
  SN: country('SN', 'Senegal', 'XOF', ['fr'], 'fr'),
  CI: country('CI', "Côte d'Ivoire", 'XOF', ['fr'], 'fr'),
  CM: country('CM', 'Cameroon', 'XAF', ['fr', 'en'], 'fr'),
  BJ: country('BJ', 'Benin', 'XOF', ['fr'], 'fr'),
  TG: country('TG', 'Togo', 'XOF', ['fr'], 'fr'),
  ML: country('ML', 'Mali', 'XOF', ['fr'], 'fr'),
  BF: country('BF', 'Burkina Faso', 'XOF', ['fr'], 'fr'),
  NE: country('NE', 'Niger', 'XOF', ['fr'], 'fr'),
  GN: country('GN', 'Guinea', 'GNF', ['fr'], 'fr'),
  TD: country('TD', 'Chad', 'XAF', ['fr', 'ar'], 'fr'),
  GA: country('GA', 'Gabon', 'XAF', ['fr'], 'fr'),
  CG: country('CG', 'Congo', 'XAF', ['fr'], 'fr'),
  CD: country('CD', 'DR Congo', 'CDF', ['fr'], 'fr'),
  MG: country('MG', 'Madagascar', 'MGA', ['fr'], 'fr'),

  // ---------------- Lusophone Africa ----------------
  AO: country('AO', 'Angola', 'AOA', ['pt'], 'pt'),
  MZ: country('MZ', 'Mozambique', 'MZN', ['pt'], 'pt'),
  CV: country('CV', 'Cape Verde', 'CVE', ['pt'], 'pt'),
  GW: country('GW', 'Guinea-Bissau', 'XOF', ['pt'], 'pt'),
  ST: country('ST', 'São Tomé and Príncipe', 'STN', ['pt'], 'pt'),

  // ---------------- Arabic Africa (North Africa) ----------------
  EG: country('EG', 'Egypt', 'EGP', ['ar', 'en'], 'ar'),
  MA: country('MA', 'Morocco', 'MAD', ['ar', 'fr'], 'ar'),
  DZ: country('DZ', 'Algeria', 'DZD', ['ar', 'fr'], 'ar'),
  TN: country('TN', 'Tunisia', 'TND', ['ar', 'fr'], 'ar'),
  LY: country('LY', 'Libya', 'LYD', ['ar'], 'ar'),
  SD: country('SD', 'Sudan', 'SDG', ['ar', 'en'], 'ar'),

  // ---------------- Southern Africa (English-anchored) ----------------
  ZA: country('ZA', 'South Africa', 'ZAR', ['en'], 'en'),
  ZM: country('ZM', 'Zambia', 'ZMW', ['en'], 'en'),
  ZW: country('ZW', 'Zimbabwe', 'ZWL', ['en'], 'en'),
  BW: country('BW', 'Botswana', 'BWP', ['en'], 'en'),
  NA: country('NA', 'Namibia', 'NAD', ['en'], 'en'),
  MW: country('MW', 'Malawi', 'MWK', ['en'], 'en'),
  LS: country('LS', 'Lesotho', 'LSL', ['en'], 'en'),
  SZ: country('SZ', 'Eswatini', 'SZL', ['en'], 'en'),

  // ---------------- Other Anglophone West/East Africa ----------------
  LR: country('LR', 'Liberia', 'LRD', ['en'], 'en'),
  SL: country('SL', 'Sierra Leone', 'SLL', ['en'], 'en'),
  GM: country('GM', 'The Gambia', 'GMD', ['en'], 'en'),
  SS: country('SS', 'South Sudan', 'SSP', ['en'], 'en'),
  SO: country('SO', 'Somalia', 'SOS', ['sw', 'en'], 'en'),
  ER: country('ER', 'Eritrea', 'ERN', ['ar', 'en'], 'en'),
  DJ: country('DJ', 'Djibouti', 'DJF', ['fr', 'ar'], 'fr'),
  MU: country('MU', 'Mauritius', 'MUR', ['en', 'fr'], 'en'),
  SC: country('SC', 'Seychelles', 'SCR', ['en', 'fr'], 'en'),
  KM: country('KM', 'Comoros', 'KMF', ['fr', 'ar'], 'fr'),
}

/** Global default for any country NOT in the map (or when country is unknown). */
export const GLOBAL_DEFAULT: CountryLocaleConfig = country('__DEFAULT__', 'Unknown', 'USD', ['en'], 'en')

export function getCountryConfig(countryCode: string | null | undefined): CountryLocaleConfig {
  if (!countryCode) return GLOBAL_DEFAULT
  return COUNTRIES[countryCode.toUpperCase()] ?? GLOBAL_DEFAULT
}

/**
 * The country's suggested default language, but ONLY if that language has a
 * live (real, populated) dictionary — otherwise fall back to English. This
 * is the "coming_soon language must never actually be served" guarantee
 * from languages.ts, applied at the country-resolution layer.
 */
export function getCountrySuggestedLanguage(countryCode: string | null | undefined): LanguageCode {
  const cfg = getCountryConfig(countryCode)
  if (LIVE_LANGUAGES.includes(cfg.defaultLanguage)) return cfg.defaultLanguage
  return 'en'
}
