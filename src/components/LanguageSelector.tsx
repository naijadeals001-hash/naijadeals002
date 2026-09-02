import type { FC } from 'hono/jsx'
import type { LocaleContext } from '../i18n'
import { LANGUAGES, LIVE_LANGUAGES, LANG_QUERY_PARAM } from '../i18n'

interface LanguageSelectorProps {
  locale: LocaleContext
  /** Where this instance is rendered — purely affects styling, not behavior. */
  variant: 'utility-bar' | 'mobile-icon' | 'footer'
}

/**
 * No-JS-required language switcher: a <details>/<summary> disclosure whose
 * options are plain links to `?lang=<code>` on the CURRENT path (so it works
 * even before app.js has loaded, and works with query strings already on
 * the page since we only ever set/replace the `lang` param client-side via
 * href — see the href builder below, which preserves the current path).
 * Selecting a link causes attachLocale (src/lib/auth.ts) to see
 * `explicitQueryLang` on the next request, resolve source:'manual', and
 * persist it via cookie (+ DB if logged in) — see detector.ts priority #1.
 *
 * Only LIVE languages are clickable. coming_soon languages are listed
 * (Section 1's "architecture must show continent-wide extensibility") but
 * rendered disabled/greyed — never a broken/half-translated page (Section 9).
 */
export const LanguageSelector: FC<LanguageSelectorProps> = ({ locale, variant }) => {
  const current = LANGUAGES[locale.language]
  const liveList = LIVE_LANGUAGES.map((code) => LANGUAGES[code])
  const comingSoonList = Object.values(LANGUAGES).filter((l) => l.status === 'coming_soon')

  const wrapperClass =
    variant === 'footer'
      ? 'relative inline-block text-white/70'
      : variant === 'mobile-icon'
      ? 'relative inline-block'
      : 'relative inline-block hover:text-white transition-colors'

  const summaryClass =
    variant === 'mobile-icon'
      ? 'flex items-center justify-center w-8 h-8 rounded-full bg-white/10 cursor-pointer list-none'
      : 'flex items-center gap-1 cursor-pointer list-none'

  return (
    <details class={wrapperClass}>
      <summary class={summaryClass} aria-label="Change language">
        <span class="material-symbols-outlined text-[16px] leading-none">language</span>
        {variant !== 'mobile-icon' && <span class="text-xs font-medium">{current.nativeName}</span>}
      </summary>
      <div class="absolute right-0 z-50 mt-2 w-52 max-h-80 overflow-y-auto rounded-md bg-white text-gray-800 shadow-lg ring-1 ring-black/10 py-1 text-sm">
        {liveList.map((lang) => (
          <a
            href={`?${LANG_QUERY_PARAM}=${lang.code}`}
            class={`flex items-center justify-between px-3 py-1.5 hover:bg-gray-100 ${lang.code === locale.language ? 'font-semibold text-primary' : ''}`}
          >
            <span>{lang.nativeName}</span>
            {lang.code !== 'en' && <span class="text-[10px] text-gray-400 ml-2">beta</span>}
          </a>
        ))}
        {comingSoonList.length > 0 && (
          <div class="border-t border-gray-100 mt-1 pt-1">
            {comingSoonList.map((lang) => (
              <span class="flex items-center justify-between px-3 py-1.5 text-gray-400 cursor-not-allowed">
                <span>{lang.nativeName}</span>
                <span class="text-[10px]">Soon</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
