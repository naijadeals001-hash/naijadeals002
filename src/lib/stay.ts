/**
 * NaijaStay — Stay domain read helpers layered on top of the pre-existing,
 * vertical-agnostic Booking Engine 2.0 (src/lib/bookings.ts,
 * booking-availability.ts, booking-holds.ts). This file adds ZERO new
 * tables and ZERO new write paths — every booking/hold/payment/
 * cancellation write still goes exclusively through the generic
 * bookingsApi (src/routes/api-bookings.ts). This module exists purely to
 * give the NaijaStay SSR pages ergonomic reads against the
 * stay_properties / stay_unit_details tables (migrations 0034/0028) that
 * the generic engine correctly has no reason to know about, joined back
 * to bookable_listings/booking_resources where needed.
 *
 * COUNTRY-READY BY CONSTRUCTION: every query below filters by
 * countryIso/city as plain parameters, never a hardcoded 'NG'/'Lagos'
 * literal baked into SQL — adding a second country later (e.g. Ghana/
 * Accra) is purely a seed-data change; zero code in this file would need
 * to change.
 */
import type { StayPropertyRow, StayUnitDetailRow, BookableListingRow, BookingResourceRow } from '../types'
export type { StayPropertyRow, StayUnitDetailRow } from '../types'

export interface StayPropertySearchOpts {
  countryIso?: string
  city?: string
  propertyType?: string
  limit?: number
  offset?: number
}

/** Public browse/search — only verified, active properties with at least one active bookable unit (mirrors searchPublicListings' "availability-aware" philosophy at the property level). */
export async function searchStayProperties(db: D1Database, opts: StayPropertySearchOpts = {}): Promise<StayPropertyRow[]> {
  const clauses = [
    `sp.is_active = 1`,
    `EXISTS (SELECT 1 FROM bookable_listings bl WHERE bl.stay_property_id = sp.id AND bl.is_active = 1 AND bl.vertical = 'stay')`
  ]
  const binds: unknown[] = []
  if (opts.countryIso) {
    clauses.push('sp.country_iso = ?')
    binds.push(opts.countryIso)
  }
  if (opts.city) {
    clauses.push('sp.city = ?')
    binds.push(opts.city)
  }
  if (opts.propertyType) {
    clauses.push('sp.property_type = ?')
    binds.push(opts.propertyType)
  }
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0
  binds.push(limit, offset)

  const { results } = await db
    .prepare(`SELECT sp.* FROM stay_properties sp WHERE ${clauses.join(' AND ')} ORDER BY sp.rating_avg DESC, sp.id ASC LIMIT ? OFFSET ?`)
    .bind(...binds)
    .all<StayPropertyRow>()
  return results
}

/** Public property detail by slug — the URL-facing lookup for /stay/property/:slug. */
export async function getStayPropertyBySlug(db: D1Database, slug: string): Promise<StayPropertyRow | null> {
  return db.prepare('SELECT * FROM stay_properties WHERE slug = ? AND is_active = 1').bind(slug).first<StayPropertyRow>()
}

export async function getStayPropertyById(db: D1Database, id: number): Promise<StayPropertyRow | null> {
  return db.prepare('SELECT * FROM stay_properties WHERE id = ? AND is_active = 1').bind(id).first<StayPropertyRow>()
}

/** All bookable units (bookable_listings rows) belonging to one property, each joined with its stay_unit_details row and its (first/pooled) booking_resources row for capacity display. One property can have N unit types (e.g. "Deluxe Room" vs "Executive Suite"), each its own bookable_listings row. */
export interface StayUnitWithDetails extends BookableListingRow {
  unit_type: string
  max_guests: number
  resource_id: number
  capacity_units: number
}

export async function getUnitsForProperty(db: D1Database, propertyId: number): Promise<StayUnitWithDetails[]> {
  const { results } = await db
    .prepare(
      `SELECT bl.*, sud.unit_type, sud.max_guests, br.id AS resource_id, br.capacity_units
       FROM bookable_listings bl
       JOIN stay_unit_details sud ON sud.listing_id = bl.id
       JOIN booking_resources br ON br.listing_id = bl.id AND br.is_active = 1
       WHERE bl.stay_property_id = ? AND bl.is_active = 1 AND bl.vertical = 'stay'
       ORDER BY bl.base_price_kobo ASC`
    )
    .bind(propertyId)
    .all<StayUnitWithDetails>()
  return results
}

/** Single unit (bookable_listings row) + its stay_unit_details + its owning property, joined in one query — used by the booking/checkout flow page. */
export interface StayUnitFull extends BookableListingRow {
  unit_type: string
  max_guests: number
  property_slug: string
  property_name: string
  property_city: string
  property_cover_image_url: string | null
}

export async function getStayUnitById(db: D1Database, listingId: number): Promise<StayUnitFull | null> {
  return db
    .prepare(
      `SELECT bl.*, sud.unit_type, sud.max_guests,
              sp.slug AS property_slug, sp.name AS property_name, sp.city AS property_city, sp.cover_image_url AS property_cover_image_url
       FROM bookable_listings bl
       JOIN stay_unit_details sud ON sud.listing_id = bl.id
       JOIN stay_properties sp ON sp.id = bl.stay_property_id
       WHERE bl.id = ? AND bl.is_active = 1 AND bl.vertical = 'stay'`
    )
    .bind(listingId)
    .first<StayUnitFull>()
}

/** Distinct cities that currently have at least one active stay property — drives the "Popular destinations" grid without a hardcoded city list, so a future 2nd country's cities appear automatically once seeded. */
export async function getStayDestinationCities(db: D1Database, countryIso?: string): Promise<{ city: string; country_iso: string; property_count: number }[]> {
  const clauses = [`sp.is_active = 1`]
  const binds: unknown[] = []
  if (countryIso) {
    clauses.push('sp.country_iso = ?')
    binds.push(countryIso)
  }
  const { results } = await db
    .prepare(
      `SELECT sp.city, sp.country_iso, COUNT(*) AS property_count
       FROM stay_properties sp
       WHERE ${clauses.join(' AND ')}
       GROUP BY sp.city, sp.country_iso
       ORDER BY property_count DESC`
    )
    .bind(...binds)
    .all<{ city: string; country_iso: string; property_count: number }>()
  return results
}

/** The lowest-priced active unit for a property — used to render "from ₦X/night" on browse cards without N+1 loading every unit. */
export async function getMinPriceForProperty(db: D1Database, propertyId: number): Promise<number | null> {
  const row = await db
    .prepare(`SELECT MIN(base_price_kobo) AS min_price FROM bookable_listings WHERE stay_property_id = ? AND is_active = 1 AND vertical = 'stay'`)
    .bind(propertyId)
    .first<{ min_price: number | null }>()
  return row?.min_price ?? null
}

/** Distinct property types currently in inventory, with counts — drives the icon row (Hotels/Apartments/Resorts/...) from real data rather than a hardcoded list of 8 types that may not all have inventory yet. */
export async function getStayPropertyTypeCounts(db: D1Database): Promise<{ property_type: string; count: number }[]> {
  const { results } = await db
    .prepare(`SELECT property_type, COUNT(*) AS count FROM stay_properties WHERE is_active = 1 GROUP BY property_type`)
    .all<{ property_type: string; count: number }>()
  return results
}
