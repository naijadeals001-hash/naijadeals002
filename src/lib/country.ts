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
import { PRODUCT_CARD_SELECT } from './catalog'
import type { ProductWithListingRow, VendorRow } from '../types'

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
 * Country Discovery (Pat's "All 54 African Countries" directive, 2026-09-15,
 * migration 0054) — a customer-facing storytelling row, DISTINCT in purpose
 * from getAllCountries()/getLiveCountries() above (which power the
 * seller-facing "ship to" / "available in" serviceability selectors).
 */
export interface CountryDiscoveryRow {
  id: number
  iso_code: string
  name: string
  region: string
  status: string
  flag_emoji: string | null
  short_description: string | null
  image_url: string
}

/**
 * VISUAL AUDIT compliance (Pat's directive): only countries with a REAL,
 * verified photo (image_url set AND not the /ph.svg placeholder-generator
 * route) are eligible — a country can never render in this section without a
 * real asset. This is the exact same "show fewer, but all real" pattern
 * already applied to getTopBrands()/getPopularVendors()/PRODUCT_CARD_SELECT
 * (see catalog.ts). All 54 African UN-member states have a DB row (migration
 * 0054) the moment this ships; how many of them actually RENDER on the
 * homepage is purely a function of how many have had real photography
 * sourced/backfilled into image_url so far — zero code change needed as that
 * number grows from 0 toward 54. `display_on_homepage` is a separate,
 * independent admin kill-switch (e.g. to temporarily pull a country without
 * losing its sourced asset).
 */
export async function getDiscoverableCountries(db: D1Database, limit = 54): Promise<CountryDiscoveryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, iso_code, name, region, status, flag_emoji, short_description, image_url
       FROM cc_countries
       WHERE display_on_homepage = 1 AND image_url IS NOT NULL AND image_url NOT LIKE '/ph.svg%'
       ORDER BY (status = 'LIVE') DESC, display_order ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<CountryDiscoveryRow>()
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
 *
 * STAGE 2A: activated. Previously written (Marketplace Engine 2.1) but had
 * zero callers until the country-aware /api/catalog/products?country= param
 * and getProductsAvailableInCountry() below were added.
 */
export function countryAvailabilitySqlFragment(): string {
  return `(
    NOT EXISTS (SELECT 1 FROM listing_country_availability lca WHERE lca.listing_id = l.id)
      AND v.country_iso = ?
    OR EXISTS (SELECT 1 FROM listing_country_availability lca2 WHERE lca2.listing_id = l.id AND lca2.country_iso = ? AND lca2.is_available = 1)
  )`
}

/**
 * Stage 2A — Africa Catalog & Country Architecture.
 *
 * ============================================================================
 * THE THREE COUNTRY RELATIONSHIPS (never conflate these — see Stage 2A design
 * doc section 5 for the exact data contract):
 *
 *   1. Product -> Origin Country -> Verification -> Source
 *        table: product_country_origins (migration 0067)
 *        "where was this product made/grown/crafted" — requires explicit
 *        evidence; a product may have ZERO origin rows indefinitely, and
 *        that is the honest, correct default, never an error.
 *
 *   2. Product/Listing -> Available/Sold In -> Country
 *        table: listing_country_availability (pre-existing) +
 *               vendor-country fallback (isListingAvailableInCountry above)
 *        "can a customer in country X actually buy this listing" — this is
 *        what ?country=XX means everywhere in this app, NEVER origin.
 *
 *   3. Vendor -> Based In -> Country
 *        column: vendors.country_iso (pre-existing)
 *        "where does the seller operate" — a business/legal-presence fact,
 *        independent of what countries that vendor's listings ship to and
 *        independent of where any of their products were actually made.
 *
 * These three functions below (getProductsAvailableInCountry,
 * getProductsOriginatingFromCountry, getVendorsBasedInCountry) are the ONLY
 * sanctioned entry points for "give me the products/vendors for country X" —
 * every call site (country-detail.tsx, api-catalog.ts) must go through
 * these, never write its own inline country-filtering SQL, so the "never
 * conflate" rule is enforced structurally in one place, not by convention
 * scattered across every call site.
 * ============================================================================
 */

/**
 * Requirement #2 relationship: products whose LISTINGS are available/sold in
 * `countryIso`. Reuses the exact same PRODUCT_CARD_SELECT every other
 * merchandising rail in catalog.ts uses (same real-image gate, same joins),
 * plus countryAvailabilitySqlFragment()'s availability logic spliced in —
 * never a parallel, slightly-different product query shape.
 *
 * DOES NOT touch product_country_origins or categories.country_iso in any
 * way. A product manufactured in Kenya but sold by a Nigeria-based vendor
 * who has explicitly enabled Kenya availability correctly appears here for
 * countryIso='KE' — that is the availability relationship working exactly
 * as designed, completely independent of where the product was made.
 */
export async function getProductsAvailableInCountry(db: D1Database, countryIso: string, limit = 24, offset = 0): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(
      `${PRODUCT_CARD_SELECT} AND ${countryAvailabilitySqlFragment()}
       ORDER BY p.rating_count DESC, p.id DESC LIMIT ? OFFSET ?`
    )
    .bind(countryIso, countryIso, limit, offset)
    .all<ProductWithListingRow>()
  return results
}

/**
 * Requirement #1 relationship: products with a VERIFIED origin row for
 * `countryIso` in product_country_origins. Deliberately filters to
 * verification_status = 'verified' ONLY — an 'unverified' or 'disputed' row
 * must never surface on a public "Products From <Country>" page (this is
 * the exact honesty gate migration 0067's own header comment specifies).
 *
 * Returns an empty array for every country until a human explicitly
 * verifies at least one product's origin via the Control Center — this is
 * the correct, expected state at the close of this unit (Stage 2A adds zero
 * catalog rows and zero origin verifications).
 */
export async function getProductsOriginatingFromCountry(db: D1Database, countryIso: string, limit = 24, offset = 0): Promise<ProductWithListingRow[]> {
  const { results } = await db
    .prepare(
      `${PRODUCT_CARD_SELECT} AND EXISTS (
         SELECT 1 FROM product_country_origins pco
         WHERE pco.product_id = p.id AND pco.country_iso = ? AND pco.verification_status = 'verified'
       )
       ORDER BY p.rating_count DESC, p.id DESC LIMIT ? OFFSET ?`
    )
    .bind(countryIso, limit, offset)
    .all<ProductWithListingRow>()
  return results
}

/**
 * Requirement #3 relationship: vendors BASED IN `countryIso`
 * (vendors.country_iso — a legal/operational-presence fact, pre-existing
 * column, untouched by this migration). Same "real logo + verified" filter
 * convention as getPopularVendors() in catalog.ts — a vendor without a real
 * photo is excluded rather than rendered as a placeholder card, matching
 * this codebase's "show fewer, but all real" rule everywhere else.
 */
export async function getVendorsBasedInCountry(db: D1Database, countryIso: string, limit = 24): Promise<VendorRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM vendors
       WHERE country_iso = ? AND is_verified = 1 AND logo_url IS NOT NULL AND logo_url NOT LIKE '/ph.svg%'
       ORDER BY rating_count DESC LIMIT ?`
    )
    .bind(countryIso, limit)
    .all<VendorRow>()
  return results
}

/**
 * Requirement #4 (partial): brands "associated with" a country. Honest
 * scope limitation, documented rather than silently wrong: this codebase
 * has exactly ONE brand-nationality signal today (brands.is_nigerian,
 * preserved unchanged per Pat's explicit Stage 2A decision — no
 * brand_country_origins table is built in this unit). So NG returns the
 * existing is_nigerian=1 brand set; every other ISO honestly returns an
 * empty array rather than fabricating an association. When a generalized
 * brand-origin model is authorized as its own future unit (see Stage 2A
 * design doc section 1.4), this function's NG special-case is replaced by a
 * real per-country query — the call sites (country-detail.tsx) do not
 * change.
 */
export async function getBrandsAssociatedWithCountry(db: D1Database, countryIso: string, limit = 24) {
  if (countryIso !== 'NG') return []
  const { results } = await db
    .prepare(
      `SELECT b.id, b.slug, b.name, b.logo_url, b.is_featured, COUNT(p.id) as product_count
       FROM brands b
       JOIN products p ON p.brand_id = b.id AND p.is_active = 1
       WHERE b.is_nigerian = 1 AND b.logo_url IS NOT NULL AND b.logo_url NOT LIKE '/ph.svg%' AND b.status = 'active'
       GROUP BY b.id
       ORDER BY b.is_featured DESC, product_count DESC
       LIMIT ?`
    )
    .bind(limit)
    .all()
  return results
}
