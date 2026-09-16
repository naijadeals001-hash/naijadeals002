/**
 * Homepage feed cache — avoids re-running 10+ carousel queries on every single homepage request.
 *
 * Cloudflare Workers has a hard CPU-time budget per request (10ms free / 30ms paid). A 25-section
 * homepage that live-queries D1 for every carousel on every visitor request will eventually blow
 * that budget under real traffic. Since this deploy target supports neither KV nor Cron Triggers
 * (see project README), we can't pre-warm a cache on a schedule — so we use a LAZY REFRESH pattern:
 * each section's data is computed once and stored in `homepage_feed_cache`, then served from that
 * cache on every request until it goes stale (TTL), at which point the NEXT request recomputes it
 * inline and updates the cache for everyone after it. This bounds the "slow path" to one request
 * per TTL window per section, not one request per section per visitor.
 */
import {
  getFlashDeals,
  getBestSellers,
  getNewArrivals,
  getTrending,
  getRecommended,
  getDiscounted,
  getNigerianBrandProducts,
  getTopBrands,
  getPopularVendors,
  getLimitedTimeDeals,
  getPopularCategories,
  getFeaturedHomeCategories
} from './catalog'
import { getActiveHeroCampaigns } from './hero-campaigns'

const TTL_SECONDS = 120 // recompute at most once every 2 minutes per section

// Only sections that are the SAME for every visitor belong here (cacheable). Visitor-specific
// sections — "Deals Near You" (depends on the city the visitor picked) and "Recently Viewed"
// (depends on that visitor's own browsing history) — are NOT cacheable and must never be added
// to this map. They are fetched live, per-request, via getDealsNearYouLive/getRecentlyViewedLive
// below, called directly from the home.tsx route handler alongside (not through) this cache.
const SECTION_LOADERS: Record<string, (db: D1Database) => Promise<any>> = {
  // Hero campaigns listed first: it's the top-of-page section, and keeping it first
  // in this map makes the cache-warm order match the visual reading order.
  hero_campaigns: (db) => getActiveHeroCampaigns(db, 12),
  flash_deals: (db) => getFlashDeals(db, 12),
  best_sellers: (db) => getBestSellers(db, 12),
  new_arrivals: (db) => getNewArrivals(db, 12),
  trending: (db) => getTrending(db, 12),
  recommended: (db) => getRecommended(db, 12),
  todays_deals: (db) => getDiscounted(db, 12),
  limited_time_deals: (db) => getLimitedTimeDeals(db, 10),
  nigerian_brands: (db) => getNigerianBrandProducts(db, 12),
  top_brands: (db) => getTopBrands(db, 12),
  shop_by_category: (db) => getFeaturedHomeCategories(db, 12),
  popular_categories: (db) => getPopularCategories(db, 10),
  popular_vendors: (db) => getPopularVendors(db, 8)
}

async function getCachedSection<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db
    .prepare('SELECT payload_json, generated_at FROM homepage_feed_cache WHERE section_key = ?')
    .bind(key)
    .first<{ payload_json: string; generated_at: string }>()
  if (!row) return null
  const ageSeconds = (Date.now() - new Date(row.generated_at + 'Z').getTime()) / 1000
  if (ageSeconds > TTL_SECONDS) return null
  return JSON.parse(row.payload_json) as T
}

async function setCachedSection(db: D1Database, key: string, data: any) {
  await db
    .prepare(
      `INSERT INTO homepage_feed_cache (section_key, payload_json, generated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(section_key) DO UPDATE SET payload_json = excluded.payload_json, generated_at = excluded.generated_at`
    )
    .bind(key, JSON.stringify(data))
    .run()
}

/** Fetches one homepage section, using the cache if fresh, else recomputing + refreshing it. */
async function getSection<T>(db: D1Database, key: string): Promise<T> {
  const cached = await getCachedSection<T>(db, key)
  if (cached) return cached
  const loader = SECTION_LOADERS[key]
  const fresh = await loader(db)
  await setCachedSection(db, key, fresh)
  return fresh as T
}

/** Loads ALL cacheable homepage sections in parallel (each independently cache-checked). */
export async function getHomepageFeed(db: D1Database) {
  const keys = Object.keys(SECTION_LOADERS)
  const values = await Promise.all(keys.map((k) => getSection(db, k)))
  const feed: Record<string, any> = {}
  keys.forEach((k, i) => (feed[k] = values[i]))
  return feed as {
    hero_campaigns: any[]
    flash_deals: any[]
    best_sellers: any[]
    new_arrivals: any[]
    trending: any[]
    recommended: any[]
    todays_deals: any[]
    limited_time_deals: any[]
    nigerian_brands: any[]
    top_brands: any[]
    shop_by_category: any[]
    popular_categories: any[]
    popular_vendors: any[]
  }
}
