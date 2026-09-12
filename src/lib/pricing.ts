/**
 * Marketplace Engine 2.0 — Pricing (spec sections 10 & 11).
 *
 * Preserves the existing flat `price_kobo` retail model exactly. Tiered/bulk
 * pricing is a purely additive, OPTIONAL layer: a listing with no rows in
 * product_pricing_tiers behaves identically to today. The single entry point
 * every call site (cart/checkout/product page/seller UI) should use is
 * `resolveUnitPriceKobo`, which is the ONLY server-side authority for "what
 * does this listing cost per unit at quantity N" — the client-supplied price
 * is NEVER trusted (spec section 38).
 */
import type { PricingTierRow } from '../types'

export interface ListingPriceInput {
  price_kobo: number
  compare_at_price_kobo?: number | null
}

/**
 * Returns all active pricing tiers for a listing, ordered by min_quantity.
 */
export async function getPricingTiersForListing(db: D1Database, listingId: number): Promise<PricingTierRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM product_pricing_tiers WHERE listing_id = ? AND is_active = 1 ORDER BY min_quantity ASC')
    .bind(listingId)
    .all<PricingTierRow>()
  return results
}

/**
 * THE single server-side authority for "what is the per-unit price (in
 * kobo) for this listing at this quantity". Never accept a price from the
 * client — always recompute here from the listing's flat price_kobo plus
 * whatever tiers exist in the database at call time.
 *
 * Resolution rule: the highest tier whose [min_quantity, max_quantity] range
 * contains `quantity` wins. If no tier matches (including the common case of
 * zero tiers existing at all), the listing's flat price_kobo is used — this
 * is what makes tiered pricing purely additive and 100%-backward-compatible.
 */
export function resolveUnitPriceKoboFromTiers(basePriceKobo: number, tiers: PricingTierRow[], quantity: number): number {
  if (tiers.length === 0) return basePriceKobo
  let best: PricingTierRow | null = null
  for (const tier of tiers) {
    if (quantity < tier.min_quantity) continue
    if (tier.max_quantity !== null && quantity > tier.max_quantity) continue
    if (!best || tier.min_quantity > best.min_quantity) best = tier
  }
  return best ? best.unit_price_kobo : basePriceKobo
}

/**
 * Convenience wrapper that fetches tiers fresh from the DB and resolves the
 * unit price in one call — use this from checkout/cart recalculation paths
 * that must never trust a client-supplied price.
 */
export async function resolveUnitPriceKobo(db: D1Database, listingId: number, basePriceKobo: number, quantity: number): Promise<number> {
  const tiers = await getPricingTiersForListing(db, listingId)
  return resolveUnitPriceKoboFromTiers(basePriceKobo, tiers, quantity)
}

export interface UpsertPricingTierInput {
  min_quantity: number
  max_quantity: number | null
  unit_price_kobo: number
  tier_label?: string | null
  sort_order?: number
}

/**
 * Replaces ALL pricing tiers for a listing atomically (delete + re-insert in
 * one batch). Ownership of `listingId` MUST already be verified by the
 * caller (see src/lib/seller-products.ts's assertListingOwnedByVendor) —
 * this function itself does not re-check ownership.
 */
export async function replacePricingTiers(db: D1Database, listingId: number, tiers: UpsertPricingTierInput[]): Promise<void> {
  for (const t of tiers) {
    if (t.min_quantity < 1) throw new Error('min_quantity must be >= 1')
    if (t.max_quantity !== null && t.max_quantity !== undefined && t.max_quantity < t.min_quantity) {
      throw new Error('max_quantity must be >= min_quantity')
    }
    if (t.unit_price_kobo <= 0) throw new Error('unit_price_kobo must be > 0')
  }

  const statements = [
    db.prepare('DELETE FROM product_pricing_tiers WHERE listing_id = ?').bind(listingId),
    ...tiers.map((t, i) =>
      db
        .prepare(
          `INSERT INTO product_pricing_tiers (listing_id, min_quantity, max_quantity, unit_price_kobo, tier_label, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(listingId, t.min_quantity, t.max_quantity ?? null, t.unit_price_kobo, t.tier_label ?? null, t.sort_order ?? i)
    ),
  ]
  await db.batch(statements)
}

/**
 * Computes the total price (in kobo) for `quantity` units of a listing,
 * using tiered pricing when available. This is the function checkout/cart
 * subtotal calculations should call instead of `price_kobo * quantity`.
 */
export async function calculateLineTotalKobo(db: D1Database, listingId: number, basePriceKobo: number, quantity: number): Promise<{ unitPriceKobo: number; lineTotalKobo: number }> {
  const unitPriceKobo = await resolveUnitPriceKobo(db, listingId, basePriceKobo, quantity)
  return { unitPriceKobo, lineTotalKobo: unitPriceKobo * quantity }
}

/**
 * Variable-weight settlement (spec section 13): given the nominal
 * unit_price_kobo (price per unit_of_measure, e.g. per kg) and the ACTUAL
 * fulfilled quantity, computes the final amount owed. Rounds to the nearest
 * kobo (never fractional currency).
 */
export function calculateVariableWeightFinalPriceKobo(unitPriceKobo: number, fulfilledQuantity: number): number {
  return Math.round(unitPriceKobo * fulfilledQuantity)
}

/**
 * Validates that a fulfilled quantity is within the listing's configured
 * variable-weight tolerance of the originally ordered quantity. Returns
 * true if within tolerance (or if the listing isn't variable-weight, in
 * which case exact match is required).
 */
export function isFulfilledQuantityWithinTolerance(orderedQuantity: number, fulfilledQuantity: number, toleranceyPct: number): boolean {
  if (toleranceyPct <= 0) return fulfilledQuantity === orderedQuantity
  const lower = orderedQuantity * (1 - toleranceyPct / 100)
  const upper = orderedQuantity * (1 + toleranceyPct / 100)
  return fulfilledQuantity >= lower && fulfilledQuantity <= upper
}
