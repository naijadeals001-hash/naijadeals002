/**
 * Marketplace Engine 2.1 — Country/location integration boundary (spec
 * section 11).
 *
 * Does NOT build a competing Country Engine. Migration 0013 already
 * reconstructed `cc_countries`/`cc_country_settings` from production
 * (confirmed via inspection: 0 rows, 0 application-code references before
 * this Engine 2.1 pass). This module is ONLY the Marketplace-side
 * integration boundary spec section 11 asks for:
 *   Product -> Listing -> Country availability -> Serviceability
 * using the EXISTING cc_countries table (now seeded by migration 0040)
 * plus the NEW, purely additive `listing_country_availability` table
 * (also migration 0040).
 *
 * NO fake GPS. NO fake location matching. Availability is a simple,
 * honest, seller/admin-DECLARED boolean per (listing, country) — nothing
 * more is claimed.
 */

export interface CountryRow {
  id: number
  iso_code: string
  name: string
  region: string
  currency_code: string
  status: string
}

/** Every country the Control Center foundation knows about, LIVE markets first — the customer-facing "ship to" / seller "available in" selector data source. */
export async function getAllCountries(db: D1Database): Promise<CountryRow[]> {
  const { results } = await db
    .prepare(`SELECT id, iso_code, name, region, currency_code, status FROM cc_countries ORDER BY (status = 'LIVE') DESC, display_order ASC`)
    .all<CountryRow>()
  return results
}

export async function getLiveCountries(db: D1Database): Promise<CountryRow[]> {
  const { results } = await db
    .prepare(`SELECT id, iso_code, name, region, currency_code, status FROM cc_countries WHERE status = 'LIVE' ORDER BY display_order ASC`)
    .all<CountryRow>()
  return results
}

/**
 * Whether a listing is available in `countryIso`. Rule (spec section 11's
 * conceptual model): absence of ANY explicit row for a listing means
 * "available only in the vendor's own country_iso" — the honest default
 * that matches today's actual Nigeria-only reality without claiming a
 * seller ships everywhere. An explicit row overrides that default in
 * either direction (opt in to an extra country, or opt out of the
 * seller's own country if they've deliberately paused it there).
 */
export async function isListingAvailableInCountry(db: D1Database, listingId: number, countryIso: string): Promise<boolean> {
  const explicit = await db
    .prepare('SELECT is_available FROM listing_country_availability WHERE listing_id = ? AND country_iso = ?')
    .bind(listingId, countryIso)
    .first<{ is_available: number }>()
  if (explicit) return explicit.is_available === 1

  const vendor = await db
    .prepare(`SELECT v.country_iso FROM product_listings l JOIN vendors v ON v.id = l.vendor_id WHERE l.id = ?`)
    .bind(listingId)
    .first<{ country_iso: string }>()
  return vendor?.country_iso === countryIso
}

/** Seller-facing: set explicit availability for their OWN listing in a country. Ownership MUST already be verified by the caller (getOwnedListing), mirrors every other seller-products.ts mutation's contract. */
export async function setListingCountryAvailability(db: D1Database, listingId: number, countryIso: string, isAvailable: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO listing_country_availability (listing_id, country_iso, is_available) VALUES (?, ?, ?)
       ON CONFLICT(listing_id, country_iso) DO UPDATE SET is_available = excluded.is_available`
    )
    .bind(listingId, countryIso, isAvailable ? 1 : 0)
    .run()
}

export async function getListingCountryAvailability(db: D1Database, listingId: number) {
  const { results } = await db.prepare('SELECT country_iso, is_available FROM listing_country_availability WHERE listing_id = ?').bind(listingId).all()
  return results
}

/**
 * Catalog-query helper: appends a country-availability filter to an
 * existing product/listing SQL query. Deliberately a SQL fragment + bind
 * value the caller splices in, rather than a full query builder, since
 * every call site (api-catalog.ts's /products, /products/:slug) already
 * has its own base query shape this must not disturb.
 */
export function countryAvailabilitySqlFragment(): string {
  return `(
    NOT EXISTS (SELECT 1 FROM listing_country_availability lca WHERE lca.listing_id = l.id)
      AND v.country_iso = ?
    OR EXISTS (SELECT 1 FROM listing_country_availability lca2 WHERE lca2.listing_id = l.id AND lca2.country_iso = ? AND lca2.is_available = 1)
  )`
}
