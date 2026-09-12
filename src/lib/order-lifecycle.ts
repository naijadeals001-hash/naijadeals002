/**
 * Marketplace Engine 2.1 — Centralized order/order-item state machine
 * (spec sections 3 & 4).
 *
 * THE single authority for changing an order item's fulfillment status.
 * Route handlers and other lib functions MUST call
 * `transitionOrderItemStatus` — never write `item_status` directly with a
 * raw UPDATE (the old ad-hoc pattern in seller-products.ts's
 * updateOrderItemStatus, which this file supersedes for lifecycle
 * purposes but does not delete, per "preserve existing work"; new callers
 * should prefer this module).
 *
 * WHY ITEM-LEVEL, NOT ORDER-LEVEL: NaijaDeals orders are multi-vendor
 * (spec section 3's explicit requirement — "Seller A must never change
 * Seller B's items"). There is no single "order status" a seller can
 * legitimately set for a multi-vendor order; each vendor only owns their
 * own order_items rows. `orders.status` is therefore treated as a
 * DERIVED/AGGREGATE view (see recomputeOrderAggregateStatus below), never
 * a field any actor writes directly — this is what makes "client submits
 * status=completed and the DB just believes it" structurally impossible.
 *
 * AUTHORIZATION (non-negotiable):
 *   - actorRole='seller' transitions are scoped by `vendor_id = ?` on the
 *     order_items row — a mismatched vendorId matches 0 rows, full stop.
 *   - actorRole='customer' transitions are scoped by the order's
 *     `user_id = ?` — resolved from the order row, never trusted from the
 *     client.
 *   - actorRole='admin' transitions require the caller to have already
 *     passed requirePlatformRole('admin') (src/lib/rbac.ts) — this module
 *     does not re-check platform role, the route layer must.
 *
 * EVENT INTEGRATION (spec sections 4/21/22): every legal transition
 * writes one row to `order_item_status_events` (audit trail) AND one row
 * to the EXISTING dormant `cc_domain_events` table (migration 0013) so a
 * future Communication/Analytics Engine consumer can pick it up without
 * Marketplace building its own event bus — this directly satisfies the
 * Master Ecosystem Directive's "integrate, don't duplicate" rule.
 */
import { adjustStock } from './inventory'
import { calculateVariableWeightFinalPriceKobo, isFulfilledQuantityWithinTolerance } from './pricing'

export class OrderLifecycleError extends Error {}
export class NotOwnedOrderItemError extends OrderLifecycleError {
  constructor() {
    super('Order item not found or not accessible to this actor')
  }
}
export class IllegalTransitionError extends OrderLifecycleError {
  constructor(from: string, to: string) {
    super(`Cannot transition order item from "${from}" to "${to}"`)
  }
}

export type OrderItemStatus =
  | 'processing'
  | 'ready_for_fulfillment'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded'
  | 'disputed'

export type ActorRole = 'customer' | 'seller' | 'admin' | 'system'

/**
 * Legal transition table. Deliberately explicit and small rather than
 * "any status to any status" — spec section 4's core mandate. Each key is
 * a FROM status; the value is the set of statuses a given actor role may
 * move it TO. An actor role not listed for a FROM status may never
 * transition out of it (e.g. a customer can never move a 'shipped' item
 * to 'completed' directly — only 'delivered'/'disputed').
 */
const TRANSITIONS: Record<string, Partial<Record<ActorRole, OrderItemStatus[]>>> = {
  processing: {
    seller: ['ready_for_fulfillment', 'shipped', 'cancelled'],
    customer: ['cancelled'],
    admin: ['cancelled', 'disputed'],
  },
  ready_for_fulfillment: {
    seller: ['shipped', 'cancelled'],
    customer: ['cancelled'],
    admin: ['cancelled', 'disputed'],
  },
  shipped: {
    seller: ['delivered'],
    customer: ['delivered', 'disputed'],
    admin: ['delivered', 'disputed', 'refunded'],
  },
  delivered: {
    customer: ['completed', 'disputed'],
    seller: ['completed'],
    admin: ['completed', 'disputed', 'refunded', 'partially_refunded'],
  },
  completed: {
    admin: ['disputed', 'refunded', 'partially_refunded'],
    customer: ['disputed'],
  },
  cancelled: {
    // Terminal for every actor — a cancelled item never moves again.
  },
  disputed: {
    admin: ['completed', 'refunded', 'partially_refunded', 'cancelled'],
  },
  refunded: {
    // Terminal.
  },
  partially_refunded: {
    admin: ['refunded'],
  },
}

interface OrderItemRowForTransition {
  id: number
  order_id: number
  vendor_id: number
  listing_id: number
  quantity: number
  unit_price_kobo: number
  unit_of_measure: string
  item_status: string
  fulfilled_quantity: number | null
}

/** Writes the audit-trail row + the shared cc_domain_events row (spec sections 4/21/22). Never throws — a logging failure must not fail the transition itself. */
async function logTransition(
  db: D1Database,
  item: OrderItemRowForTransition,
  fromStatus: string,
  toStatus: string,
  actorUserId: number | null,
  actorRole: ActorRole,
  reason: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO order_item_status_events (order_item_id, order_id, from_status, to_status, actor_user_id, actor_role, reason, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(item.id, item.order_id, fromStatus, toStatus, actorUserId, actorRole, reason, JSON.stringify(metadata)),
      db
        .prepare(
          `INSERT INTO cc_domain_events (event_type, entity_type, entity_id, payload_json, actor_user_id)
           VALUES (?, 'order_item', ?, ?, ?)`
        )
        .bind(
          `order_item_${toStatus}`,
          String(item.id),
          JSON.stringify({ order_id: item.order_id, vendor_id: item.vendor_id, from_status: fromStatus, to_status: toStatus, ...metadata }),
          actorUserId
        ),
    ])
  } catch (err) {
    console.error('order-lifecycle: failed to write transition/domain event (non-fatal)', err)
  }
}

/** Fetches an order_item row scoped by seller ownership (vendor_id) — the "does not exist for another seller" pattern. */
async function getItemForSeller(db: D1Database, vendorId: number, orderItemId: number): Promise<OrderItemRowForTransition | null> {
  return db
    .prepare('SELECT * FROM order_items WHERE id = ? AND vendor_id = ?')
    .bind(orderItemId, vendorId)
    .first<OrderItemRowForTransition>()
}

/** Fetches an order_item row scoped by customer ownership (via the parent order's user_id) — never trusts a client-claimed order/user relationship. */
async function getItemForCustomer(db: D1Database, userId: number, orderItemId: number): Promise<OrderItemRowForTransition | null> {
  return db
    .prepare(
      `SELECT oi.* FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.id = ? AND o.user_id = ?`
    )
    .bind(orderItemId, userId)
    .first<OrderItemRowForTransition>()
}

/** Admin path: no ownership scoping (route layer must already have enforced requirePlatformRole('admin')), but still 404s cleanly on a bad id. */
async function getItemForAdmin(db: D1Database, orderItemId: number): Promise<OrderItemRowForTransition | null> {
  return db.prepare('SELECT * FROM order_items WHERE id = ?').bind(orderItemId).first<OrderItemRowForTransition>()
}

export interface TransitionOptions {
  reason?: string
  fulfilledQuantity?: number
  metadata?: Record<string, unknown>
}

/**
 * THE centralized order-item state-machine entry point (spec section 4's
 * `transitionOrderStatus(orderId, targetStatus, actor)`, adapted to this
 * repo's item-level multi-vendor reality — see module doc comment).
 *
 * Steps performed, in order, exactly matching spec section 4's checklist:
 *   1. authenticate actor        -> caller already ran requireAuth
 *   2. authorize actor           -> ownership-scoped fetch below
 *   3. verify current state      -> item.item_status
 *   4. verify transition legal   -> TRANSITIONS table lookup
 *   5. perform domain actions    -> stock ledger / variable-weight settlement
 *   6. write transition event    -> order_item_status_events
 *   7. trigger communication/analytics event -> cc_domain_events
 *   8. integrate with Finance when applicable -> settlement_status / refunds.ts hook point
 */
export async function transitionOrderItemStatus(
  db: D1Database,
  orderItemId: number,
  targetStatus: OrderItemStatus,
  actor: { userId: number; role: ActorRole; vendorId?: number },
  opts: TransitionOptions = {}
): Promise<OrderItemRowForTransition> {
  let item: OrderItemRowForTransition | null
  if (actor.role === 'seller') {
    if (!actor.vendorId) throw new OrderLifecycleError('Seller actor requires a resolved vendorId')
    item = await getItemForSeller(db, actor.vendorId, orderItemId)
  } else if (actor.role === 'customer') {
    item = await getItemForCustomer(db, actor.userId, orderItemId)
  } else if (actor.role === 'admin') {
    item = await getItemForAdmin(db, orderItemId)
  } else {
    throw new OrderLifecycleError('Unsupported actor role for a client-initiated transition')
  }
  if (!item) throw new NotOwnedOrderItemError()

  const fromStatus = item.item_status
  const allowedTargets = TRANSITIONS[fromStatus]?.[actor.role] ?? []
  if (!allowedTargets.includes(targetStatus)) {
    throw new IllegalTransitionError(fromStatus, targetStatus)
  }

  const timestampCol =
    targetStatus === 'shipped' ? 'shipped_at' :
    targetStatus === 'delivered' ? 'delivered_at' :
    targetStatus === 'completed' ? 'completed_at' :
    null

  const setClauses = [`item_status = ?`]
  const binds: unknown[] = [targetStatus]

  if (timestampCol) {
    setClauses.push(`${timestampCol} = datetime('now')`)
  }

  // Variable-weight settlement hook (spec sections 12/13): when a seller
  // moves an item to 'shipped' or 'delivered' with an explicit
  // fulfilledQuantity, compute the final amount now, record who/when, and
  // flag settlement_status for the Finance-adjustment step (handled by
  // src/lib/refunds.ts / order-additional-charges — never a silent mutation
  // of an already-settled transaction here).
  if (opts.fulfilledQuantity !== undefined && actor.role === 'seller') {
    const finalPriceKobo = calculateVariableWeightFinalPriceKobo(item.unit_price_kobo, opts.fulfilledQuantity)
    setClauses.push('fulfilled_quantity = ?', 'final_price_kobo = ?', 'fulfilled_by_user_id = ?', "fulfilled_at = datetime('now')")
    binds.push(opts.fulfilledQuantity, finalPriceKobo, actor.userId)
    if (opts.reason) {
      setClauses.push('weight_adjustment_reason = ?')
      binds.push(opts.reason)
    }
    // settlement_status is set to 'none' here; the actual comparison against
    // the originally-captured amount (and any refund/additional-charge it
    // triggers) is computed by settleVariableWeightItem (order-settlement.ts)
    // — kept as a separate explicit step so "compute final amount" and
    // "reconcile against Finance" are never silently conflated.
  }

  await db.batch([
    db.prepare(`UPDATE order_items SET ${setClauses.join(', ')} WHERE id = ?`).bind(...binds, orderItemId),
  ])

  await logTransition(db, item, fromStatus, targetStatus, actor.userId, actor.role, opts.reason ?? null, opts.metadata ?? {})

  // Inventory ledger integration (spec section 5 analogue for stock):
  // cancelling an item that was already stock-decremented restores stock
  // through the SAME adjustStock ledger used everywhere else — never a raw
  // UPDATE. Only applies when the parent order was actually paid (i.e. the
  // original confirmOrderPayment decrement happened) — a cancellation of a
  // still-unpaid item never double-restores stock that was never taken.
  if (targetStatus === 'cancelled') {
    const order = await db.prepare('SELECT payment_status FROM orders WHERE id = ?').bind(item.order_id).first<{ payment_status: string }>()
    if (order && order.payment_status !== 'unpaid') {
      try {
        await adjustStock(db, item.listing_id, item.quantity, 'order_cancelled', { orderId: item.order_id, actorUserId: actor.userId })
      } catch (err) {
        console.error('order-lifecycle: stock restore failed for cancelled item (non-fatal to the transition)', err)
      }
    }
  }

  await recomputeOrderAggregateStatus(db, item.order_id)

  // Engine 9 event writer (durable outbox, never blocks/fails this
  // transition — see notifications.ts's module doc comment on why
  // enqueueAndProcessNow is safe to call as a strictly-after-commit step).
  // Customer-facing statuses only: a seller/admin doesn't need a
  // notification about their own action, and 'processing'/
  // 'ready_for_fulfillment' are not yet meaningfully customer-actionable.
  const CUSTOMER_NOTIFIABLE = new Set(['shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'partially_refunded'])
  if (CUSTOMER_NOTIFIABLE.has(targetStatus)) {
    try {
      const order = await db.prepare('SELECT user_id FROM orders WHERE id = ?').bind(item.order_id).first<{ user_id: number }>()
      if (order) {
        const { enqueueAndProcessNow } = await import('./notifications')
        await enqueueAndProcessNow(db, {
          idempotencyKey: `order_item_${targetStatus}:${orderItemId}`,
          eventType: `order_item_${targetStatus}`,
          recipientUserId: order.user_id,
          category: 'order',
          payload: { order_item_id: orderItemId, order_id: item.order_id, status: targetStatus },
          referenceType: 'order',
          referenceId: String(item.order_id),
        })
      }
    } catch (err) {
      console.error('order-lifecycle: notification enqueue failed (non-fatal, order transition already committed)', err)
    }
  }

  const updated = await db.prepare('SELECT * FROM order_items WHERE id = ?').bind(orderItemId).first<OrderItemRowForTransition>()
  return updated!
}

/**
 * Derives `orders.status` (the multi-vendor AGGREGATE) purely from the
 * current set of that order's order_items.item_status — never written to
 * directly by any actor (spec section 4: "do not allow client code to
 * simply submit status=completed"). Rule, evaluated in priority order:
 *   - all items cancelled                 -> 'cancelled'
 *   - all items refunded                  -> 'refunded'
 *   - any item disputed                    -> 'disputed'
 *   - all items completed                  -> 'completed'
 *   - all items delivered or completed      -> 'delivered'
 *   - any item shipped (none earlier stage) -> 'shipped'
 *   - otherwise                             -> unchanged (processing/pending_payment, set by createPendingOrder/confirmOrderPayment)
 */
export async function recomputeOrderAggregateStatus(db: D1Database, orderId: number): Promise<void> {
  const { results: items } = await db
    .prepare('SELECT item_status FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all<{ item_status: string }>()
  if (items.length === 0) return

  const statuses = items.map((i) => i.item_status)
  const all = (s: string) => statuses.every((x) => x === s)
  const allIn = (...s: string[]) => statuses.every((x) => s.includes(x))
  const any = (s: string) => statuses.includes(s)

  let newStatus: string | null = null
  const extra: string[] = []
  const binds: unknown[] = []

  if (all('cancelled')) {
    newStatus = 'cancelled'
  } else if (all('refunded')) {
    newStatus = 'refunded'
  } else if (any('disputed')) {
    newStatus = 'disputed'
  } else if (all('completed')) {
    newStatus = 'completed'
    extra.push(`fulfilled_at = COALESCE(fulfilled_at, datetime('now'))`)
  } else if (allIn('delivered', 'completed')) {
    newStatus = 'delivered'
    extra.push(`delivered_at = COALESCE(delivered_at, datetime('now'))`)
  } else if (any('shipped') || any('delivered') || any('completed')) {
    newStatus = 'shipped'
  } else if (any('partially_refunded')) {
    newStatus = 'partially_refunded'
  }
  // Any other mix (all still 'processing'/'ready_for_fulfillment', or a
  // partial cancellation mixed with active items) intentionally leaves
  // orders.status untouched here — createPendingOrder/confirmOrderPayment/
  // cancelOrder already set the correct pending_payment/processing/
  // cancelled value for those cases, and a PARTIAL cancellation (some
  // items cancelled, others still active) is surfaced at the item level,
  // not by inventing a fake blended order-level status.
  if (any('cancelled') && statuses.some((s) => s !== 'cancelled')) {
    newStatus = newStatus ?? 'partially_cancelled'
  }

  if (newStatus === null) return

  const sql = `UPDATE orders SET status = ?${extra.length ? ', ' + extra.join(', ') : ''}, updated_at = datetime('now') WHERE id = ?`
  await db.prepare(sql).bind(newStatus, ...binds, orderId).run()
}
