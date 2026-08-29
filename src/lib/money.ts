/**
 * Money is always stored/passed internally as integer kobo (1 NGN = 100 kobo).
 * NEVER use floating point for currency math — this module is the only place
 * that should format kobo into a display string.
 */

export function koboToNaira(kobo: number): number {
  return kobo / 100
}

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100)
}

export function formatNaira(kobo: number): string {
  const naira = koboToNaira(kobo)
  return '₦' + naira.toLocaleString('en-NG', {
    minimumFractionDigits: naira % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })
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
