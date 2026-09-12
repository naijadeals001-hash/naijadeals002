/**
 * Marketplace Engine 2.1 — Refunds & Disputes (spec section 6).
 *
 * HARD RULE (non-negotiable, Master Ecosystem Directive section 6/16):
 * Marketplace NEVER mutates wallet_ledger/wallet_accounts directly. Every
 * refund's actual money movement goes through src/lib/wallet.ts's
 * creditWallet — the ONE authoritative financial ledger in this repo. This
 * file owns only the COMMERCE CONTEXT (which order/item, how much, why,
 * who authorized it, and — after the fact — which wallet_ledger row paid
 * it out), stored in the `refunds` / `disputes` tables added by migration
 * 0040.
 *
 * SAFETY INVARIANTS enforced here:
 *   - a refund can never exceed the item's/order's captured amount
 *     (line_total_kobo, or final_price_kobo once fulfilled) minus whatever
 *     has already been refunded/claimed against it — prevents both
 *     "refund more than was paid" and "duplicate refund" in one check.
 *   - every refund references order_id (+ order_item_id when item-scoped)
 *     — never a bare amount with no commerce context.
 *   - seller/admin-initiated refunds are both supported, but always
 *     authorized by the caller (route layer) before this module runs —
 *     this module itself does not re-derive "is this actor allowed",
 *     it only enforces the financial invariants once ownership /role is
 *     already established.
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 2, Unit 5 — G-4, see
 * docs/ENGINE-7-PHASE-2-FORENSIC-REVIEW.md §F for the original finding):
 * the prior implementation computed `alreadyRefunded` by summing existing
 * `status='completed'` rows, checked `amountKobo <= remaining` in
 * application code, and ONLY THEN inserted the new refund row — a classic
 * read-used-to-authorize-a-write race. Two concurrent
 * createAndExecuteRefund() calls against the SAME order/item could both
 * read the same `alreadyRefunded` sum, both independently pass the
 * `remaining` check, and both proceed to insert+credit — together
 * exceeding the captured amount. Unlike G-1/G-2/G-3 (Booking/Wallet/Order),
 * this is NOT a single-row enum-state claim (there is no one
 * "refund_status" column on the order to CAS on — an order can legally
 * have MANY completed partial refunds against it over time, so
 * `resolveDispute()`'s exact `UPDATE ... WHERE status IN (...)` shape does
 * NOT transfer here; it was considered and explicitly rejected — see
 * claimRefundSlot()'s own header comment below for why). This is instead
 * an AGGREGATE-CONSTRAINT race: many rows may exist, but their SUM must
 * never exceed a cap. The fix re-derives Unit 2's own generalization
 * (numeric-CAS via a guarded write, not an enum-CAS) one level further: a
 * guarded INSERT whose WHERE clause re-evaluates the SAME aggregate SUM
 * AT INSERT TIME, inside the single atomic statement SQLite/D1 actually
 * executes it as — so no two concurrent callers can ever both see
 * "room available" for amounts that together exceed the cap, no matter
 * how many already-completed/pending rows exist or how they're
 * interleaved.
 */
import { creditWallet } from './wallet'

export class RefundError extends Error {}

interface OrderItemForRefund {
  id: number
  order_id: number
  vendor_id: number
  unit_price_kobo: number
  quantity: number
  line_total_kobo: number
  final_price_kobo: number | null
}

interface OrderForRefund {
  id: number
  user_id: number
  total_kobo: number
}

/**
 * Read-only diagnostic/display helper ONLY (e.g. showing "already refunded:
 * X" in an admin UI before submission) — NEVER used to authorize a write.
 * The actual safety check lives entirely inside claimRefundSlot()'s single
 * atomic statement below, which re-derives this exact same SUM itself, at
 * write time, inside the guarded INSERT — this function's result is
 * necessarily stale the instant a concurrent caller writes, which is
 * exactly why it must never gate a mutation.
 */
async function getAlreadyRefundedKobo(db: D1Database, orderId: number, orderItemId: number | null): Promise<number> {
  const row = orderItemId
    ? await db
        .prepare(`SELECT COALESCE(SUM(amount_kobo), 0) AS total FROM refunds WHERE order_item_id = ? AND status IN ('completed', 'pending')`)
        .bind(orderItemId)
        .first<{ total: number }>()
    : await db
        .prepare(`SELECT COALESCE(SUM(amount_kobo), 0) AS total FROM refunds WHERE order_id = ? AND order_item_id IS NULL AND status IN ('completed', 'pending')`)
        .bind(orderId)
        .first<{ total: number }>()
  return row?.total ?? 0
}

/**
 * ATOMIC CLAIM for a refund amount against an aggregate refundable cap.
 *
 * WHY NOT resolveDispute()'s enum-CAS shape: that pattern claims a SINGLE
 * row's SINGLE status transition (`UPDATE ... SET status=? WHERE id=? AND
 * status IN (allowed-old-values)`) — it works because a dispute has
 * exactly one mutable state to guard. A refund has no such single state:
 * an order/item can legitimately accumulate many independent completed
 * partial refunds over its lifetime, so there is no "the one row" to CAS
 * on — the invariant to protect is an AGGREGATE (SUM of many rows <=
 * captured amount), not a single row's transition. Blindly copying the
 * enum-CAS shape here would only protect against re-claiming the SAME
 * refund row twice — it does nothing to stop two DIFFERENT concurrent
 * refund attempts from each seeing "there's room" and both inserting.
 *
 * THE FIX: an atomic guarded INSERT ... SELECT ... WHERE, where the WHERE
 * clause's guard condition is a correlated subquery that re-computes the
 * SAME "amount already claimed" SUM the read-then-check code used to
 * compute — but INSIDE the single INSERT statement SQLite/D1 actually
 * executes atomically (D1/SQLite guarantees a single statement's read and
 * write happen as one indivisible unit — no other statement can interleave
 * between this statement's internal SELECT and its INSERT). This is the
 * exact generalization of Unit 2's numeric-CAS
 * (`UPDATE wallet_accounts SET balance = balance - ? WHERE balance >= ?`)
 * to an INSERT-based aggregate constraint instead of a single mutable
 * column: the guard is re-evaluated at write time by the SAME atomic
 * statement, not by an earlier, now-stale read.
 *
 * The SUM deliberately includes BOTH 'completed' AND 'pending' rows (not
 * just 'completed') — this closes a SECOND, subtler race the original
 * code had even ignoring concurrency: the original SUM only counted
 * 'completed' rows, meaning the brief window between "insert the pending
 * row" and "mark it completed" was invisible to the guard. Counting
 * 'pending' too means the CLAIM itself (this INSERT) is what reserves the
 * capacity, not the eventual completion — mirroring claim-before-debit's
 * own principle (Unit 4) at the aggregate-constraint level: reserve first,
 * then execute the money movement, never the other way round.
 *
 * Returns the new refund row's id if the claim won, or null if it lost
 * (this amount would have pushed the total claimed beyond capturedKobo).
 */
async function claimRefundSlot(
  db: D1Database,
  orderId: number,
  orderItemId: number | null,
  vendorId: number | null,
  amountKobo: number,
  capturedKobo: number,
  reason: string,
  refundType: string,
  initiatedByUserId: number,
  initiatedByRole: string
): Promise<number | null> {
  const scopeGuard = orderItemId !== null ? 'order_item_id = ?' : 'order_id = ? AND order_item_id IS NULL'
  const scopeBind = orderItemId !== null ? orderItemId : orderId

  const claim = await db
    .prepare(
      `INSERT INTO refunds (order_id, order_item_id, vendor_id, amount_kobo, reason, refund_type, status, initiated_by_user_id, initiated_by_role)
       SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?
       WHERE ? <= (? - COALESCE(
         (SELECT SUM(amount_kobo) FROM refunds WHERE ${scopeGuard} AND status IN ('completed', 'pending')),
         0
       ))`
    )
    .bind(
      orderId,
      orderItemId,
      vendorId,
      amountKobo,
      reason,
      refundType,
      initiatedByUserId,
      initiatedByRole,
      amountKobo,
      capturedKobo,
      scopeBind
    )
    .run()

  if ((claim.meta.rows_written ?? 0) === 0) return null
  return Number(claim.meta.last_row_id)
}

export interface CreateRefundInput {
  orderId: number
  orderItemId?: number | null
  amountKobo: number
  reason: string
  refundType: 'full' | 'partial' | 'item' | 'quantity' | 'cancellation'
  initiatedByUserId: number
  initiatedByRole: 'customer' | 'seller' | 'admin' | 'system'
}

/**
 * Creates AND immediately executes a refund (no separate approval queue in
 * this build — every caller must already have verified authorization at
 * the route layer, e.g. requirePlatformRole('admin') or seller ownership
 * of the item). Claims an aggregate-refundable-amount slot ATOMICALLY via
 * claimRefundSlot() FIRST (mirroring Unit 4's claim-before-debit
 * principle), then executes the financial credit via creditWallet SECOND,
 * rolling the claim back to `status='rejected'` if the credit ever fails
 * — the refund row is never left silently 'pending' forever with no
 * credit and no explanation.
 *
 * Throws RefundError if amountKobo would push total refunds for this
 * order/item beyond the captured amount (now verified ATOMICALLY, safe
 * under concurrency — see claimRefundSlot()'s header comment), or if
 * amountKobo <= 0.
 */
export async function createAndExecuteRefund(db: D1Database, input: CreateRefundInput): Promise<{ refundId: number; walletLedgerId: number; newBalanceKobo: number }> {
  if (input.amountKobo <= 0) throw new RefundError('Refund amount must be positive')

  const order = await db.prepare('SELECT id, user_id, total_kobo FROM orders WHERE id = ?').bind(input.orderId).first<OrderForRefund>()
  if (!order) throw new RefundError('Order not found')

  let capturedKobo: number
  let vendorId: number | null = null
  if (input.orderItemId) {
    const item = await db
      .prepare('SELECT id, order_id, vendor_id, unit_price_kobo, quantity, line_total_kobo, final_price_kobo FROM order_items WHERE id = ? AND order_id = ?')
      .bind(input.orderItemId, input.orderId)
      .first<OrderItemForRefund>()
    if (!item) throw new RefundError('Order item not found for this order')
    capturedKobo = item.final_price_kobo ?? item.line_total_kobo
    vendorId = item.vendor_id
  } else {
    capturedKobo = order.total_kobo
  }

  // ATOMIC CLAIM FIRST — see claimRefundSlot()'s header comment for the
  // full rationale. This single statement re-verifies "is there still
  // room under the cap" AND reserves this amount's share of it, as one
  // indivisible operation — no concurrent caller can ever observe a
  // window where two refunds both believe they have room for the same
  // capacity.
  const refundId = await claimRefundSlot(
    db,
    input.orderId,
    input.orderItemId ?? null,
    vendorId,
    input.amountKobo,
    capturedKobo,
    input.reason,
    input.refundType,
    input.initiatedByUserId,
    input.initiatedByRole
  )
  if (refundId === null) {
    // Re-read the current aggregate purely for a helpful, accurate error
    // message — this read is NOT what authorized the rejection (the claim
    // statement above already made that decision atomically); by the time
    // this message is composed, the true remaining amount may have
    // changed again, and that's fine — it's diagnostic text, not a gate.
    const alreadyClaimed = await getAlreadyRefundedKobo(db, input.orderId, input.orderItemId ?? null)
    throw new RefundError(
      `Refund amount (${input.amountKobo}) exceeds the remaining refundable amount (${Math.max(0, capturedKobo - alreadyClaimed)}) for this ${input.orderItemId ? 'item' : 'order'} — captured: ${capturedKobo}, already refunded/claimed: ${alreadyClaimed}`
    )
  }

  try {
    // reference_id is the refund's OWN id (not the bare orderId) so that
    // TWO concurrent/sequential refunds against the SAME order (e.g. two
    // different items, or two partial refunds) can never collide on the
    // same reference_id — each credit is uniquely traceable back to
    // exactly the refund row that caused it, never "whichever wallet_ledger
    // row happens to be most recent for this order" (the prior
    // implementation's lookup-by-orderId, ORDER BY id DESC LIMIT 1, could
    // have silently attached the WRONG ledger id to a refund row if two
    // refunds for the same order completed close together).
    const newBalanceKobo = await creditWallet(
      db,
      order.user_id,
      input.amountKobo,
      'order_refund',
      String(refundId),
      `Refund for order #${input.orderId}${input.orderItemId ? ` (item #${input.orderItemId})` : ''}: ${input.reason}`
    )

    const ledgerRow = await db
      .prepare(`SELECT id FROM wallet_ledger WHERE user_id = ? AND reference_type = 'order_refund' AND reference_id = ? ORDER BY id DESC LIMIT 1`)
      .bind(order.user_id, String(refundId))
      .first<{ id: number }>()

    await db
      .prepare(`UPDATE refunds SET status = 'completed', wallet_ledger_id = ?, completed_at = datetime('now') WHERE id = ?`)
      .bind(ledgerRow?.id ?? null, refundId)
      .run()

    // Engine 9 event writer — fires strictly AFTER the wallet credit and
    // refund-row completion have already committed (financial atomicity
    // preserved first, per Engine 9's mandate; see notifications.ts).
    try {
      const { enqueueAndProcessNow } = await import('./notifications')
      await enqueueAndProcessNow(db, {
        idempotencyKey: `refund_completed:${refundId}`,
        eventType: 'refund_completed',
        recipientUserId: order.user_id,
        category: 'payment',
        payload: { refund_id: refundId, order_id: input.orderId, amount_kobo: input.amountKobo, reason: input.reason },
        referenceType: 'order',
        referenceId: String(input.orderId),
      })
    } catch (err) {
      console.error('Notification enqueue failed for refund', refundId, err)
    }

    return { refundId, walletLedgerId: ledgerRow?.id ?? 0, newBalanceKobo }
  } catch (err) {
    // The credit failed AFTER the claim succeeded — roll the claim back to
    // 'rejected' (a real, permanent status this table's own CHECK
    // constraint already allows) so the claimed amount is released back
    // into the aggregate cap and this refund attempt is visibly failed,
    // never silently stuck 'pending' forever holding capacity hostage.
    // Never rolled back to 'pending' (which would just re-race) or
    // deleted (an audit trail of the failed attempt is exactly what an
    // admin investigating a payment-provider outage needs).
    await db
      .prepare(`UPDATE refunds SET status = 'rejected', completed_at = datetime('now') WHERE id = ? AND status = 'pending'`)
      .bind(refundId)
      .run()
    throw err
  }
}

export async function getRefundsForOrder(db: D1Database, orderId: number) {
  const { results } = await db.prepare('SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at DESC').bind(orderId).all()
  return results
}

/** Seller/admin-scoped: refunds against items belonging to a specific vendor, never another vendor's refund history. */
export async function getRefundsForVendor(db: D1Database, vendorId: number, limit = 50) {
  const { results } = await db
    .prepare('SELECT * FROM refunds WHERE vendor_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(vendorId, limit)
    .all()
  return results
}

// ---------- Disputes ----------

export interface CreateDisputeInput {
  orderId: number
  orderItemId?: number | null
  raisedByUserId: number
  againstVendorId?: number | null
  reason: string
  description?: string
}

export async function createDispute(db: D1Database, input: CreateDisputeInput): Promise<number> {
  const order = await db.prepare('SELECT id, user_id FROM orders WHERE id = ? AND user_id = ?').bind(input.orderId, input.raisedByUserId).first<{ id: number }>()
  if (!order) throw new RefundError('Order not found or not owned by this customer')

  const result = await db
    .prepare(
      `INSERT INTO disputes (order_id, order_item_id, raised_by_user_id, against_vendor_id, reason, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(input.orderId, input.orderItemId ?? null, input.raisedByUserId, input.againstVendorId ?? null, input.reason, input.description ?? '')
    .run()
  return Number(result.meta.last_row_id)
}

export async function getDisputesForOrder(db: D1Database, orderId: number) {
  const { results } = await db.prepare('SELECT * FROM disputes WHERE order_id = ? ORDER BY created_at DESC').bind(orderId).all()
  return results
}

/** Admin-facing: every open/investigating dispute across the platform, oldest first (FIFO queue). Route MUST already be gated by requirePlatformRole('admin'). */
export async function getOpenDisputesForAdmin(db: D1Database, limit = 100) {
  const { results } = await db
    .prepare(`SELECT * FROM disputes WHERE status IN ('open', 'investigating') ORDER BY created_at ASC LIMIT ?`)
    .bind(limit)
    .all()
  return results
}

export async function resolveDispute(db: D1Database, disputeId: number, resolvedByUserId: number, status: 'resolved' | 'rejected', resolutionNote: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE disputes SET status = ?, resolution_note = ?, resolved_by_user_id = ?, resolved_at = datetime('now') WHERE id = ? AND status IN ('open', 'investigating')`
    )
    .bind(status, resolutionNote, resolvedByUserId, disputeId)
    .run()
  return (result.meta.rows_written ?? 0) > 0
}
