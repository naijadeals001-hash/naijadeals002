/**
 * Centralized social media link configuration — Unit 5A (Footer & Navigation
 * Truth Pass, Pat's directive 2026-09-18), activated in Unit D (Footer
 * Reconciliation, 2026-09-18) with Pat's real, explicitly-supplied handles.
 *
 * WHY THIS FILE EXISTS: the footer needs a social icon row. Per Pat's
 * explicit "DO NOT INVENT SOCIAL MEDIA URLs" rule, every platform defaults
 * to `null` (unconfigured/hidden) unless Pat has explicitly supplied the
 * real, official URL below.
 *
 * UNIT D ACTIVATION (2026-09-18): Pat supplied 4 real accounts verbatim —
 * Instagram, YouTube, TikTok, X/Twitter. Facebook, LinkedIn, and Pinterest
 * remain `null` (Pat did not supply accounts for these; they stay hidden).
 * NOTE: Pat confirmed the handle mismatch (naijadeals1 vs naijadeals2 across
 * platforms) is INTENTIONAL — do not "correct" it to be consistent.
 *
 * HOW TO ACTIVATE A PLATFORM LATER: once a real, official NaijaDeals social
 * account exists, set its value below to the exact profile URL. The footer
 * (Layout.tsx) automatically shows/hides each icon based on whether its
 * value here is non-null — no component change required, per Pat's "easy to
 * populate later without changing the footer component" instruction.
 *
 * This is intentionally a static source file, not a DB table or Cloudflare
 * secret: social handles are public, non-sensitive, rarely-changing
 * configuration — the same class of "constant, code-reviewed value" as the
 * Tailwind theme colors in Layout.tsx, not a runtime secret or per-tenant
 * setting. If NaijaDeals later wants Control-Center-editable social links
 * (mirroring the hero-campaigns-admin.ts pattern), that is a separate,
 * larger unit — out of scope for this truth-pass correction.
 */

export interface SocialLinkDef {
  /** Material Symbols icon name (same icon font already used everywhere else in this app). */
  icon: string
  /** Accessible label, e.g. "NaijaDeals on Instagram". */
  label: string
  /** Real, official profile URL — null means "not configured yet, hide this icon". NEVER a fabricated/guessed URL or a generic platform homepage. */
  url: string | null
}

export const SOCIAL_LINKS: readonly SocialLinkDef[] = [
  { icon: 'facebook', label: 'NaijaDeals on Facebook', url: null },
  { icon: 'photo_camera', label: 'NaijaDeals on Instagram', url: 'https://instagram.com/naijadeals1' },
  { icon: 'music_note', label: 'NaijaDeals on TikTok', url: 'https://www.tiktok.com/@naijadeals1' },
  { icon: 'smart_display', label: 'NaijaDeals on YouTube', url: 'https://youtube.com/@NaijaDeals1' },
  { icon: 'close', label: 'NaijaDeals on X', url: 'https://x.com/naijadeals2' },
  { icon: 'work', label: 'NaijaDeals on LinkedIn', url: null },
  { icon: 'push_pin', label: 'NaijaDeals on Pinterest', url: null },
] as const

/** Only the platforms that currently have a real, configured URL — this is what the footer should actually render. */
export function getConfiguredSocialLinks(): SocialLinkDef[] {
  return SOCIAL_LINKS.filter((s): s is SocialLinkDef & { url: string } => s.url !== null)
}
