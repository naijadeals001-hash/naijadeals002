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
 *     has already been refunded against it — prevents both "refund more
 *     than was paid" and "duplicate refund" in one check.
 *   - every refund references order_id (+ order_item_id when item-scoped)
 *     — never a bare amount with no commerce context.
 *   - seller/admin-initiated refunds are both supported, but always
 *     authorized by the caller (route layer) before this module runs —
 *     this module itself does not re-derive "is this actor allowed",
 *     it only enforces the financial invariants once ownership /role is
 *     already established.
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

async function getAlreadyRefundedKobo(db: D1Database, orderId: number, orderItemId: number | null): Promise<number> {
  const row = orderItemId
    ? await db
        .prepare(`SELECT COALESCE(SUM(amount_kobo), 0) AS total FROM refunds WHERE order_item_id = ? AND status = 'completed'`)
        .bind(orderItemId)
        .first<{ total: number }>()
    : await db
        .prepare(`SELECT COALESCE(SUM(amount_kobo), 0) AS total FROM refunds WHERE order_id = ? AND order_item_id IS NULL AND status = 'completed'`)
        .bind(orderId)
        .first<{ total: number }>()
  return row?.total ?? 0
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
 * of the item). Executes the financial credit via creditWallet, then
 * records the resulting wallet_ledger row id back onto the refunds row so
 * the two are mutually traceable.
 *
 * Throws RefundError if amountKobo would push total refunds for this
 * order/item beyond the captured amount, or if amountKobo <= 0.
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

  const alreadyRefunded = await getAlreadyRefundedKobo(db, input.orderId, input.orderItemId ?? null)
  const remaining = capturedKobo - alreadyRefunded
  if (input.amountKobo > remaining) {
    throw new RefundError(
      `Refund amount (${input.amountKobo}) exceeds the remaining refundable amount (${remaining}) for this ${input.orderItemId ? 'item' : 'order'} — captured: ${capturedKobo}, already refunded: ${alreadyRefunded}`
    )
  }

  // Insert the pending commerce-context row FIRST so we have a refund_id to
  // reference from the wallet_ledger description/reference_id, then
  // execute the actual credit, then mark completed + store the ledger id.
  const inserted = await db
    .prepare(
      `INSERT INTO refunds (order_id, order_item_id, vendor_id, amount_kobo, reason, refund_type, status, initiated_by_user_id, initiated_by_role)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(input.orderId, input.orderItemId ?? null, vendorId, input.amountKobo, input.reason, input.refundType, input.initiatedByUserId, input.initiatedByRole)
    .run()
  const refundId = Number(inserted.meta.last_row_id)

  const newBalanceKobo = await creditWallet(
    db,
    order.user_id,
    input.amountKobo,
    'order_refund',
    String(input.orderId),
    `Refund for order #${input.orderId}${input.orderItemId ? ` (item #${input.orderItemId})` : ''}: ${input.reason}`
  )

  // Look up the ledger row creditWallet just wrote (most recent credit row
  // for this user with this reference) so refunds.wallet_ledger_id is
  // traceable — never guessed/derived from newBalanceKobo alone.
  const ledgerRow = await db
    .prepare(`SELECT id FROM wallet_ledger WHERE user_id = ? AND reference_type = 'order_refund' AND reference_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(order.user_id, String(input.orderId))
    .first<{ id: number }>()

  await db
    .prepare(`UPDATE refunds SET status = 'completed', wallet_ledger_id = ?, completed_at = datetime('now') WHERE id = ?`)
    .bind(ledgerRow?.id ?? null, refundId)
    .run()

  return { refundId, walletLedgerId: ledgerRow?.id ?? 0, newBalanceKobo }
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
