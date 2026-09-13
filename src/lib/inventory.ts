/**
 * Marketplace Engine 2.0 — Inventory (spec sections 9 & 37).
 *
 * THE single server-side authority for reading/adjusting stock. Every stock
 * mutation MUST go through `adjustStock` so that:
 *   (a) inventory never goes negative unless the listing explicitly allows
 *       backorder (allow_backorder = 1),
 *   (b) every adjustment is recorded in the append-only
 *       `inventory_adjustments` ledger (audit trail + seller-visible
 *       inventory history),
 *   (c) `stock` and `reserved_quantity` are always updated atomically in
 *       the same statement (no read-then-write race).
 *
 * Existing code paths (orders.ts's confirmOrderPayment) currently decrement
 * `product_listings.stock` directly via MAX(0, stock - qty) in a db.batch —
 * that pre-existing path is NOT modified here (Section 41: never rewrite
 * working code without cause), but NEW seller-facing inventory management
 * (manual restock/adjustment, order cancellation, reservation on
 * checkout) uses these functions going forward.
 */
import type { ListingRow } from '../types'
import { enqueueSearchIndexEvent } from './search-index-events'

export class InsufficientStockError extends Error {
  constructor(public listingId: number, public requested: number, public available: number) {
    super(`Insufficient stock for listing ${listingId}: requested ${requested}, available ${available}`)
  }
}

/**
 * Engine 11 event writer, called inline after adjustStock's batch commits
 * — mirrors seller-products.ts/services.ts/bookings.ts's emit*SearchEvent()
 * pattern exactly (read updated_at back from the row, own try/catch, never
 * fatal to the stock mutation it follows). This is write path #9 of the
 * 9 confirmed real write paths (previously missed - adjustStock emitted
 * zero events of any kind before this instrumentation).
 */
async function emitProductListingSearchEvent(db: D1Database, listingId: number): Promise<void> {
  try {
    const row = await db.prepare('SELECT updated_at FROM product_listings WHERE id = ?').bind(listingId).first<{ updated_at: string }>()
    if (!row) return
    await enqueueSearchIndexEvent(db, { entityType: 'product_listing', entityId: listingId, operation: 'upsert', sourceUpdatedAt: row.updated_at })
  } catch (err) {
    console.error('inventory: search index event enqueue failed (non-fatal, stock adjustment already committed)', err)
  }
}

/** available = stock - reserved_quantity, computed on read (never stored) to avoid a second source of truth. */
export function computeAvailableQuantity(listing: Pick<ListingRow, 'stock' | 'reserved_quantity'>): number {
  return Math.max(0, listing.stock - (listing.reserved_quantity ?? 0))
}

export type InventoryAdjustmentReason =
  | 'order_placed'
  | 'order_cancelled'
  | 'payment_failed'
  | 'fulfilled'
  | 'returned'
  | 'manual_adjustment'
  | 'restock'

/**
 * Applies a signed delta to product_listings.stock, guards against going
 * negative unless allow_backorder is set, and writes an append-only ledger
 * row. Returns the new stock level.
 *
 * `delta` is negative to decrement (e.g. order placed), positive to
 * increment (e.g. restock, order cancelled/returned).
 */
export async function adjustStock(
  db: D1Database,
  listingId: number,
  delta: number,
  reason: InventoryAdjustmentReason,
  opts: { orderId?: number; actorUserId?: number; note?: string; variantId?: number } = {}
): Promise<number> {
  const listing = await db
    .prepare('SELECT id, stock, allow_backorder FROM product_listings WHERE id = ?')
    .bind(listingId)
    .first<{ id: number; stock: number; allow_backorder: number }>()
  if (!listing) throw new Error(`Listing ${listingId} not found`)

  const newStock = listing.stock + delta
  if (newStock < 0 && !listing.allow_backorder) {
    throw new InsufficientStockError(listingId, -delta, listing.stock)
  }

  const clampedStock = listing.allow_backorder ? newStock : Math.max(0, newStock)

  await db.batch([
    db.prepare('UPDATE product_listings SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(clampedStock, listingId),
    db
      .prepare(
        `INSERT INTO inventory_adjustments (listing_id, variant_id, delta, reason, order_id, actor_user_id, note, stock_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(listingId, opts.variantId ?? null, delta, reason, opts.orderId ?? null, opts.actorUserId ?? null, opts.note ?? null, clampedStock),
  ])

  await emitProductListingSearchEvent(db, listingId)
  return clampedStock
}

/**
 * Reserves stock (increments reserved_quantity) without touching the raw
 * `stock` count — used to hold inventory during an in-progress checkout
 * without permanently decrementing until payment is confirmed. Guards
 * against reserving more than is available.
 */
export async function reserveStock(db: D1Database, listingId: number, quantity: number): Promise<void> {
  const listing = await db
    .prepare('SELECT stock, reserved_quantity, allow_backorder FROM product_listings WHERE id = ?')
    .bind(listingId)
    .first<{ stock: number; reserved_quantity: number; allow_backorder: number }>()
  if (!listing) throw new Error(`Listing ${listingId} not found`)

  const available = computeAvailableQuantity(listing as any)
  if (quantity > available && !listing.allow_backorder) {
    throw new InsufficientStockError(listingId, quantity, available)
  }

  await db
    .prepare('UPDATE product_listings SET reserved_quantity = reserved_quantity + ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(quantity, listingId)
    .run()
}

/** Releases a previously-reserved quantity (e.g. checkout abandoned/failed) without touching raw stock. */
export async function releaseReservedStock(db: D1Database, listingId: number, quantity: number): Promise<void> {
  await db
    .prepare('UPDATE product_listings SET reserved_quantity = MAX(0, reserved_quantity - ?), updated_at = datetime(\'now\') WHERE id = ?')
    .bind(quantity, listingId)
    .run()
}

/** Returns the recent inventory adjustment history for a listing (seller-facing, most recent first). */
export async function getInventoryHistory(db: D1Database, listingId: number, limit = 50) {
  const { results } = await db
    .prepare('SELECT * FROM inventory_adjustments WHERE listing_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(listingId, limit)
    .all()
  return results
}

/** Low-stock check used by seller inventory dashboards. */
export function isLowStock(listing: Pick<ListingRow, 'stock' | 'reserved_quantity' | 'low_stock_threshold'>): boolean {
  const threshold = listing.low_stock_threshold ?? 5
  return computeAvailableQuantity(listing) <= threshold
}
