// NaijaDeals — Supported Languages Registry
//
// Single source of truth for every language the platform architecture knows
// about. `status: 'live'` means a real, populated dictionary exists in
// src/i18n/translations/ and is safe to serve to real users. `status:
// 'coming_soon'` means the language is registered in the architecture
// (selectable, shows an honest "coming soon" state) but has NO populated
// dictionary yet — selecting it must never show fabricated or broken text.
//
// IMPORTANT: this file governs which languages EXIST as architecture. It does
// NOT decide which language a visitor sees by default — that is entirely
// src/i18n/detector.ts's job, and country/IP is only ever a suggestion there,
// never a lock (see TASK N Section 4).

export type LanguageCode =
  | 'en' | 'pcm' | 'ig' | 'yo' | 'ha' | 'tw' | 'sw' | 'fr' | 'pt' | 'ar'
  | 'rw' | 'rn' | 'am'

export type LanguageStatus = 'live' | 'coming_soon'

export interface LanguageDef {
  code: LanguageCode
  /** Name shown to an English-reading user (for admin/dev contexts). */
  englishName: string
  /** Name in the language's own script/spelling — shown in the selector UI. */
  nativeName: string
  /** BCP-47-ish direction. Only 'ar' is RTL today. */
  dir: 'ltr' | 'rtl'
  status: LanguageStatus
  /**
   * Honest disclosure for languages whose dictionary was AI-generated and has
   * NOT been reviewed by a native speaker. Surfaced in docs/I18N.md and (for
   * 'coming_soon' languages) never actually served — this flag exists so a
   * future reviewer knows exactly what to check before flipping a language
   * from unreviewed -> fully trusted, and so we never silently overclaim
   * translation quality per TASK N Section 4 / Section 15.
   */
  reviewed: boolean
}

// ---------------------------------------------------------------------------
// LIVE languages (Phase 3 of this task): dictionaries exist and are wired.
// English is the canonical source; the rest are AI-generated first drafts,
// explicitly disclosed as unreviewed. This satisfies TASK N Section 14/15's
// requirement to have a REAL, testable dictionary for all ten listed
// languages, while being honest (not silent) about review status — the
// alternative, shipping only en+pcm, would fail Section 15's explicit "prove
// Igbo/Yoruba/Hausa/Twi/Swahili/French/Portuguese/Arabic works" checklist.
// ---------------------------------------------------------------------------
export const LANGUAGES: Record<LanguageCode, LanguageDef> = {
  en:  { code: 'en',  englishName: 'English',         nativeName: 'English',        dir: 'ltr', status: 'live', reviewed: true },
  pcm: { code: 'pcm', englishName: 'Nigerian Pidgin',  nativeName: 'Naija Pidgin',    dir: 'ltr', status: 'live', reviewed: false },
  ig:  { code: 'ig',  englishName: 'Igbo',             nativeName: 'Igbo',            dir: 'ltr', status: 'live', reviewed: false },
  yo:  { code: 'yo',  englishName: 'Yoruba',           nativeName: 'Yorùbá',          dir: 'ltr', status: 'live', reviewed: false },
  ha:  { code: 'ha',  englishName: 'Hausa',            nativeName: 'Hausa',           dir: 'ltr', status: 'live', reviewed: false },
  tw:  { code: 'tw',  englishName: 'Twi',              nativeName: 'Twi',             dir: 'ltr', status: 'live', reviewed: false },
  sw:  { code: 'sw',  englishName: 'Swahili',          nativeName: 'Kiswahili',       dir: 'ltr', status: 'live', reviewed: false },
  fr:  { code: 'fr',  englishName: 'French',           nativeName: 'Français',        dir: 'ltr', status: 'live', reviewed: false },
  pt:  { code: 'pt',  englishName: 'Portuguese',       nativeName: 'Português',       dir: 'ltr', status: 'live', reviewed: false },
  ar:  { code: 'ar',  englishName: 'Arabic',           nativeName: 'العربية',          dir: 'rtl', status: 'live', reviewed: false },

  // -------------------------------------------------------------------------
  // COMING SOON: registered in the architecture (continent-wide extensibility
  // per Section 1), but NO dictionary exists yet. Selecting these in the UI
  // must show an honest "coming soon, here's English for now" state — never
  // a broken or half-translated page.
  // -------------------------------------------------------------------------
  rw:  { code: 'rw',  englishName: 'Kinyarwanda',      nativeName: 'Ikinyarwanda',    dir: 'ltr', status: 'coming_soon', reviewed: false },
  rn:  { code: 'rn',  englishName: 'Kirundi',          nativeName: 'Ikirundi',        dir: 'ltr', status: 'coming_soon', reviewed: false },
  am:  { code: 'am',  englishName: 'Amharic',          nativeName: 'አማርኛ',            dir: 'ltr', status: 'coming_soon', reviewed: false },
}

export const DEFAULT_LANGUAGE: LanguageCode = 'en'

export const LIVE_LANGUAGES: LanguageCode[] = Object.values(LANGUAGES)
  .filter((l) => l.status === 'live')
  .map((l) => l.code)

export function isValidLanguage(code: string | null | undefined): code is LanguageCode {
  return !!code && code in LANGUAGES
}

export function isLiveLanguage(code: string | null | undefined): code is LanguageCode {
  return isValidLanguage(code) && LANGUAGES[code].status === 'live'
}

export function getLanguage(code: LanguageCode): LanguageDef {
  return LANGUAGES[code]
}
