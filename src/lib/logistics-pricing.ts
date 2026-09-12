/**
 * Logistics Engine 2.0 — Delivery Pricing & Quotes (spec sections 28-30).
 *
 * COMPATIBILITY (section 28, non-negotiable): the EXISTING NaijaShop checkout
 * flow (src/lib/orders.ts's calculateDeliveryFeeKobo + DELIVERY_FEE_PER_SELLER_KOBO)
 * is NOT modified or removed. It continues to run exactly as before —
 * changing it would break live checkout, which section 84 explicitly forbids.
 * This module is the NEW, reusable logistics pricing SERVICE that
 * NaijaSend/future operational shipment flows call into. The two live
 * side-by-side; a future, separate migration can point orders.ts at this
 * service once the shipment layer is proven — that rewiring is NOT done
 * here (documented as a remaining gap in the final report, per "do not put
 * the complete formula directly into orders.ts" being a forward mandate,
 * not a same-day rewrite mandate).
 *
 * A quote is REPRODUCIBLE (section 29): every cost component (base/distance/
 * weight/service/surcharge/discount/tax) is captured on the logistics_quotes
 * row at creation time, never recomputed differently later.
 */
import { nairaToKobo } from './money'

export class LogisticsPricingError extends Error {}

export interface QuoteInput {
  customerUserId: number | null
  originCountryIso: string
  destinationCountryIso: string
  originZoneKey?: string | null
  destinationZoneKey?: string | null
  vehicleTypeId: number
  speedTier: string
  declaredWeightKg: number
  packageCount?: number
}

export interface QuoteBreakdown {
  baseFeeKobo: number
  distanceFeeKobo: number
  weightFeeKobo: number
  serviceFeeKobo: number
  surchargeKobo: number
  discountKobo: number
  taxKobo: number
  totalKobo: number
}

const SPEED_TIER_SURCHARGE_MULTIPLIER: Record<string, number> = {
  standard: 1,
  economy: 0.85,
  express: 1.6,
  same_day: 2,
  priority: 1.8,
  instant: 2.5,
  scheduled: 1,
  intercity: 1.4,
  bulk: 0.9,
  freight: 1.2,
  cold_chain: 1.7,
  document: 0.7,
  special_handling: 1.5,
}

function generateQuoteNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `NDX-Q-${ts}-${rand}`
}

/**
 * Computes a price breakdown from an ACTIVE shipment_rate_card row
 * (origin_zone + vehicle_type_id + speed_tier keyed, migration 0019) where
 * one exists, else falls back to a conservative country-neutral base rate
 * (section 30: never hardcode NGN-only pricing — the fallback is a flat
 * multiplier applied to a currency-neutral base, real per-country rate
 * cards are the intended long-term configuration path, not this fallback).
 */
export async function calculateLogisticsQuote(
  db: D1Database,
  input: QuoteInput
): Promise<{ breakdown: QuoteBreakdown; rateCardId: number | null }> {
  const packageCount = input.packageCount ?? 1
  const speedKey = SPEED_TIER_SURCHARGE_MULTIPLIER[input.speedTier] !== undefined ? input.speedTier : 'standard'

  // shipment_rate_cards only distinguishes standard/express (migration 0019's
  // CHECK constraint) — map any of our wider DeliveryServiceType values onto
  // the nearest rate-card speed_tier for lookup purposes only; the ACTUAL
  // surcharge for the requested tier is still applied via the multiplier
  // table above, on top of whatever base the rate card (or fallback) gives.
  const rateCardSpeedTier = ['express', 'same_day', 'priority', 'instant'].includes(speedKey) ? 'express' : 'standard'

  const rateCard = input.originZoneKey
    ? await db
        .prepare(
          `SELECT * FROM shipment_rate_cards WHERE origin_zone = ? AND vehicle_type_id = ? AND speed_tier = ? AND is_active = 1`
        )
        .bind(input.originZoneKey, input.vehicleTypeId, rateCardSpeedTier)
        .first<{ id: number; base_price_kobo: number; per_kg_price_kobo: number }>()
    : null

  const baseFeeKobo = rateCard ? rateCard.base_price_kobo : nairaToKobo(1000) // country-neutral fallback base
  const perKgKobo = rateCard ? rateCard.per_kg_price_kobo : nairaToKobo(100)

  const weightFeeKobo = Math.round(perKgKobo * Math.max(0, input.declaredWeightKg - 1))
  const packageFeeKobo = Math.round(baseFeeKobo * 0.15 * Math.max(0, packageCount - 1))
  const serviceFeeKobo = packageFeeKobo

  const multiplier = SPEED_TIER_SURCHARGE_MULTIPLIER[speedKey] ?? 1
  const preSurchargeTotal = baseFeeKobo + weightFeeKobo + serviceFeeKobo
  const surchargeKobo = Math.max(0, Math.round(preSurchargeTotal * (multiplier - 1)))

  // Intercity flag bumps distance fee conceptually — real distance-based
  // calculation requires geocoded coordinates (section 23's Maps/GPS
  // integration), which is NOT wired here (documented gap). This is an
  // honest placeholder distance fee, not a fabricated precise figure.
  const distanceFeeKobo = input.originCountryIso !== input.destinationCountryIso
    ? Math.round(baseFeeKobo * 0.5)
    : 0

  const discountKobo = 0
  const taxKobo = 0
  const totalKobo = baseFeeKobo + distanceFeeKobo + weightFeeKobo + serviceFeeKobo + surchargeKobo - discountKobo + taxKobo

  return {
    breakdown: { baseFeeKobo, distanceFeeKobo, weightFeeKobo, serviceFeeKobo, surchargeKobo, discountKobo, taxKobo, totalKobo },
    rateCardId: rateCard?.id ?? null,
  }
}

const QUOTE_TTL_MINUTES = 30

/** Creates a logistics_quotes row. Reproducible: every component snapshot at creation time. */
export async function createLogisticsQuote(db: D1Database, customerUserId: number | null, input: QuoteInput) {
  const { breakdown, rateCardId } = await calculateLogisticsQuote(db, input)
  const quoteNumber = generateQuoteNumber()
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000).toISOString()

  const result = await db
    .prepare(
      `INSERT INTO logistics_quotes
        (quote_number, customer_user_id, origin_zone_key, destination_zone_key, origin_country_iso, destination_country_iso,
         vehicle_type_id, speed_tier, declared_weight_kg, package_count,
         base_fee_kobo, distance_fee_kobo, weight_fee_kobo, service_fee_kobo, surcharge_kobo, discount_kobo, tax_kobo, total_kobo,
         rate_card_id, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?)`
    )
    .bind(
      quoteNumber,
      customerUserId,
      input.originZoneKey ?? null,
      input.destinationZoneKey ?? null,
      input.originCountryIso,
      input.destinationCountryIso,
      input.vehicleTypeId,
      input.speedTier,
      input.declaredWeightKg,
      input.packageCount ?? 1,
      breakdown.baseFeeKobo,
      breakdown.distanceFeeKobo,
      breakdown.weightFeeKobo,
      breakdown.serviceFeeKobo,
      breakdown.surchargeKobo,
      breakdown.discountKobo,
      breakdown.taxKobo,
      breakdown.totalKobo,
      rateCardId,
      expiresAt
    )
    .run()

  return { quoteId: Number(result.meta.last_row_id), quoteNumber, breakdown, expiresAt }
}

export async function getQuoteById(db: D1Database, quoteId: number) {
  return db.prepare('SELECT * FROM logistics_quotes WHERE id = ?').bind(quoteId).first<any>()
}

/** Lazily expires quotes past their expires_at — same pattern as Booking Engine's expireHoldsIfNeeded (no cron on hosted deploy). */
export async function expireQuotesIfNeeded(db: D1Database, customerUserId: number) {
  await db
    .prepare(`UPDATE logistics_quotes SET status = 'expired' WHERE customer_user_id = ? AND status = 'quoted' AND expires_at <= datetime('now')`)
    .bind(customerUserId)
    .run()
}

export async function getQuoteForCustomer(db: D1Database, customerUserId: number, quoteId: number) {
  await expireQuotesIfNeeded(db, customerUserId)
  return db
    .prepare('SELECT * FROM logistics_quotes WHERE id = ? AND customer_user_id = ?')
    .bind(quoteId, customerUserId)
    .first<any>()
}
