/**
 * Money is always stored/passed internally as an integer MINOR UNIT
 * (1 NGN = 100 kobo, 1 GHS = 100 pesewas, etc. — every currency this
 * platform supports today happens to use a 2-decimal minor unit, so the
 * same /100 math applies uniformly). NEVER use floating point for currency
 * math — this module is the only place that should format a minor-unit
 * integer into a display string.
 *
 * Stage 2C (Currency & Address Foundation): formatNaira()/koboToNaira()/
 * nairaToKobo() are UNCHANGED and remain byte-identical for every existing
 * NG call site — they are now thin NGN-specific wrappers around the new
 * currency-aware formatMoney()/toMajorUnits()/toMinorUnits() below, added
 * so non-NG listings (product_listings.currency) can display correctly
 * without ever being formatted as ₦.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',
  GHS: '₵',
  KES: 'KSh',
  MAD: 'MAD ',
  ZAR: 'R'
}

const CURRENCY_LOCALES: Record<string, string> = {
  NGN: 'en-NG',
  GHS: 'en-GH',
  KES: 'en-KE',
  MAD: 'fr-MA',
  ZAR: 'en-ZA'
}

export function toMajorUnits(minorUnits: number): number {
  return minorUnits / 100
}

export function toMinorUnits(majorUnits: number): number {
  return Math.round(majorUnits * 100)
}

/** Currency-aware formatter. Defaults to NGN only when no currency is supplied — never guesses from context otherwise. */
export function formatMoney(minorUnits: number, currency: string = 'NGN'): string {
  const major = toMajorUnits(minorUnits)
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' '
  const locale = CURRENCY_LOCALES[currency] ?? 'en-US'
  return symbol + major.toLocaleString(locale, {
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })
}

// ---------- NGN-specific wrappers (unchanged behavior, kept for every existing call site) ----------

export function koboToNaira(kobo: number): number {
  return toMajorUnits(kobo)
}

export function nairaToKobo(naira: number): number {
  return toMinorUnits(naira)
}

export function formatNaira(kobo: number): string {
  return formatMoney(kobo, 'NGN')
}

export function discountPercent(price_kobo: number, compare_at_kobo: number | null): number | null {
  if (!compare_at_kobo || compare_at_kobo <= price_kobo) return null
  return Math.round(((compare_at_kobo - price_kobo) / compare_at_kobo) * 100)
}

export function formatRatingCount(count: number): string {
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  }
  return String(count)
}
