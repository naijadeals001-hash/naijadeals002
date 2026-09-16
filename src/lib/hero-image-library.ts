/**
 * Hero Campaign Manager — image library manifest.
 *
 * Cloudflare Workers cannot read the filesystem at runtime (no `fs` module — see
 * this project's own CLAUDE-style deployment constraints), so the Control Center's
 * "select desktop/mobile image" picker cannot dynamically list public/static/hero/*
 * the way a Node.js admin panel could. This file is a hand-maintained manifest of
 * the git-tracked, real (non-placeholder) image pairs that already exist under
 * public/static/hero/ and public/static/ecosystem/ — every entry was verified to
 * exist on disk (`ls public/static/hero public/static/ecosystem`) before being
 * added here. This is a deliberate, honest scope cut for Checkpoint 1: it lets an
 * admin pick from real, already-approved artwork immediately, without needing a
 * new upload pipeline. Direct R2 upload for hero imagery (this project already has
 * an R2 bucket, SELLER_UPLOADS, but it is scoped to seller-owned content — a
 * marketing-owned equivalent would need its own bucket/binding) is explicitly
 * OUT OF SCOPE for this checkpoint and is not silently implied to exist.
 *
 * Adding a new campaign image going forward: generate/resize the pair into
 * public/static/hero/<slug>-{desktop,mobile}.jpg (matching every existing asset's
 * 1920x1080 desktop / 960x1200 mobile convention — see migration 0008's own
 * comment) as a normal code change, then add one entry below in the same commit.
 * The Hero Campaign Manager's "Custom URL" fallback field (in the SSR page) covers
 * the gap for anyone who adds an image without also editing this file.
 */

export interface HeroImageLibraryEntry {
  key: string
  label: string
  desktop_url: string
  mobile_url: string
  source: 'hero' | 'ecosystem'
}

export const HERO_IMAGE_LIBRARY: HeroImageLibraryEntry[] = [
  { key: 'mega-electronics-sale', label: 'Mega Electronics Sale', desktop_url: '/static/hero/mega-electronics-sale-desktop.jpg', mobile_url: '/static/hero/mega-electronics-sale-mobile.jpg', source: 'hero' },
  { key: 'ankara-fashion-edit', label: 'Ankara Fashion Edit', desktop_url: '/static/hero/ankara-fashion-edit-desktop.jpg', mobile_url: '/static/hero/ankara-fashion-edit-mobile.jpg', source: 'hero' },
  { key: 'naijadeals-ecosystem', label: 'NaijaDeals Ecosystem (one account, one ecosystem)', desktop_url: '/static/hero/naijadeals-ecosystem-desktop.jpg', mobile_url: '/static/hero/naijadeals-ecosystem-mobile.jpg', source: 'hero' },
  { key: 'everyday-groceries', label: 'Everyday Groceries', desktop_url: '/static/hero/everyday-groceries-desktop.jpg', mobile_url: '/static/hero/everyday-groceries-mobile.jpg', source: 'hero' },
  { key: 'naijasend-nationwide', label: 'NaijaSend Nationwide Delivery', desktop_url: '/static/hero/naijasend-nationwide-desktop.jpg', mobile_url: '/static/hero/naijasend-nationwide-mobile.jpg', source: 'hero' },
  { key: 'tech-accessories-deals', label: 'Tech Accessories Deals', desktop_url: '/static/hero/tech-accessories-deals-desktop.jpg', mobile_url: '/static/hero/tech-accessories-deals-mobile.jpg', source: 'hero' },
  { key: 'fashion-accessories-edit', label: 'Fashion Accessories Edit', desktop_url: '/static/hero/fashion-accessories-edit-desktop.jpg', mobile_url: '/static/hero/fashion-accessories-edit-mobile.jpg', source: 'hero' },
  { key: 'verified-sellers-escrow', label: 'Verified Sellers / Escrow Protection', desktop_url: '/static/hero/verified-sellers-escrow-desktop.jpg', mobile_url: '/static/hero/verified-sellers-escrow-mobile.jpg', source: 'hero' },
  { key: 'ecosystem-fresh', label: 'NaijaFresh (ecosystem preview)', desktop_url: '/static/ecosystem/fresh-desktop.jpg', mobile_url: '/static/ecosystem/fresh-mobile.jpg', source: 'ecosystem' },
  { key: 'ecosystem-eats', label: 'NaijaEats (ecosystem preview)', desktop_url: '/static/ecosystem/eats-desktop.jpg', mobile_url: '/static/ecosystem/eats-mobile.jpg', source: 'ecosystem' },
  { key: 'ecosystem-gigs', label: 'NaijaGigs (ecosystem preview)', desktop_url: '/static/ecosystem/gigs-desktop.jpg', mobile_url: '/static/ecosystem/gigs-mobile.jpg', source: 'ecosystem' },
  { key: 'ecosystem-stay', label: 'NaijaStay (ecosystem preview)', desktop_url: '/static/ecosystem/stay-desktop.jpg', mobile_url: '/static/ecosystem/stay-mobile.jpg', source: 'ecosystem' },
  { key: 'ecosystem-drive', label: 'NaijaDrive (ecosystem preview)', desktop_url: '/static/ecosystem/drive-desktop.jpg', mobile_url: '/static/ecosystem/drive-mobile.jpg', source: 'ecosystem' },
  { key: 'ecosystem-send', label: 'NaijaSend (ecosystem preview)', desktop_url: '/static/ecosystem/send-desktop.jpg', mobile_url: '/static/ecosystem/send-mobile.jpg', source: 'ecosystem' },
  { key: 'ecosystem-stream', label: 'NaijaStream (ecosystem preview)', desktop_url: '/static/ecosystem/stream-desktop.jpg', mobile_url: '/static/ecosystem/stream-mobile.jpg', source: 'ecosystem' },
  { key: 'ecosystem-aura', label: 'Aura AI (ecosystem preview)', desktop_url: '/static/ecosystem/aura-desktop.jpg', mobile_url: '/static/ecosystem/aura-mobile.jpg', source: 'ecosystem' },
]
