/**
 * Marketplace Engine 2.0 — Buy Box (spec section 16).
 *
 * The existing schema already has `product_listings.is_primary` as the
 * "buy box winner" flag (migration 0002), read directly by
 * PRODUCT_CARD_SELECT everywhere. This module adds a CONFIGURABLE selection
 * algorithm on top of that flag — `recomputeBuyBoxWinner` scores every
 * active, in-stock listing for a product and updates which one holds
 * is_primary=1, instead of that flag being a permanently static,
 * hand-set value.
 *
 * The customer can still view every seller via getListingsForProduct
 * (unchanged, catalog.ts) — this module only decides which single offer is
 * shown by default on cards/grids.
 */
import type { ListingRow } from '../types'

export interface BuyBoxCandidate extends ListingRow {
  vendor_rating_avg?: number
  vendor_positive_feedback_percent?: number
}

export interface BuyBoxWeights {
  price: number
  rating: number
  fulfillmentSpeed: number
  stock: number
}

export const DEFAULT_BUYBOX_WEIGHTS: BuyBoxWeights = {
  price: 0.5,
  rating: 0.25,
  fulfillmentSpeed: 0.15,
  stock: 0.1,
}

/**
 * Scores one candidate listing (0-1, higher is better) relative to the full
 * candidate set, using configurable weights. Lower price is better; higher
 * rating is better; faster delivery (lower delivery_days_min) is better;
 * more stock (up to a cap) is better. This is intentionally simple/explicit
 * rather than a black box, since sellers need to understand why they did
 * or didn't win the buy box.
 */
export function scoreCandidate(candidate: BuyBoxCandidate, allCandidates: BuyBoxCandidate[], weights: BuyBoxWeights = DEFAULT_BUYBOX_WEIGHTS): number {
  const prices = allCandidates.map((c) => c.price_kobo)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const priceScore = maxPrice === minPrice ? 1 : 1 - (candidate.price_kobo - minPrice) / (maxPrice - minPrice)

  const ratingScore = (candidate.vendor_rating_avg ?? 0) / 5

  const speeds = allCandidates.map((c) => c.delivery_days_min)
  const minSpeed = Math.min(...speeds)
  const maxSpeed = Math.max(...speeds)
  const speedScore = maxSpeed === minSpeed ? 1 : 1 - (candidate.delivery_days_min - minSpeed) / (maxSpeed - minSpeed)

  const stockScore = Math.min(1, candidate.stock / 20)

  return (
    priceScore * weights.price +
    ratingScore * weights.rating +
    speedScore * weights.fulfillmentSpeed +
    stockScore * weights.stock
  )
}

/**
 * Recomputes and persists which listing for `productId` holds the buy-box
 * (is_primary=1). Eligibility: active, moderation_status='active',
 * available stock > 0 (or backorder-enabled). If no listing is eligible,
 * no winner is set (is_primary cleared on all) — the UI must handle a
 * product with zero available offers, never assume one always exists.
 */
export async function recomputeBuyBoxWinner(db: D1Database, productId: number, weights: BuyBoxWeights = DEFAULT_BUYBOX_WEIGHTS): Promise<number | null> {
  const { results: candidates } = await db
    .prepare(
      `SELECT l.*, v.rating_avg AS vendor_rating_avg, v.positive_feedback_percent AS vendor_positive_feedback_percent
       FROM product_listings l
       JOIN vendors v ON v.id = l.vendor_id
       WHERE l.product_id = ?
         AND l.is_active = 1
         AND (l.moderation_status = 'active' OR l.moderation_status IS NULL)
         AND (l.stock - l.reserved_quantity > 0 OR l.allow_backorder = 1)`
    )
    .bind(productId)
    .all<BuyBoxCandidate>()

  if (candidates.length === 0) {
    await db.prepare('UPDATE product_listings SET is_primary = 0 WHERE product_id = ?').bind(productId).run()
    return null
  }

  let winner = candidates[0]
  let bestScore = -Infinity
  for (const c of candidates) {
    const score = scoreCandidate(c, candidates, weights)
    if (score > bestScore) {
      bestScore = score
      winner = c
    }
  }

  await db.batch([
    db.prepare('UPDATE product_listings SET is_primary = 0 WHERE product_id = ?').bind(productId),
    db.prepare('UPDATE product_listings SET is_primary = 1 WHERE id = ?').bind(winner.id),
  ])

  return winner.id
}
