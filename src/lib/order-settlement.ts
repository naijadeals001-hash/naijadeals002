/**
 * Marketplace Engine 2.1 — Variable-weight settlement (spec sections 12/13).
 *
 * Wires the previously-orphaned calculateVariableWeightFinalPriceKobo /
 * isFulfilledQuantityWithinTolerance (src/lib/pricing.ts, built in
 * Marketplace Engine 2.0 but confirmed via inspection to have ZERO
 * callers) into a real fulfillment→settlement code path.
 *
 * FLOW (matches spec section 12's architecture diagram exactly):
 *   Cart estimate -> Order estimate (line_total_kobo, captured at checkout)
 *     -> Fulfillment (seller records ACTUAL quantity via
 *        transitionOrderItemStatus's fulfilledQuantity option, which sets
 *        order_items.fulfilled_quantity/final_price_kobo)
 *     -> settleVariableWeightItem (THIS FILE) compares final_price_kobo
 *        against the originally captured line_total_kobo and, if they
 *        differ, creates EITHER:
 *          - a refund (final < captured)   -> src/lib/refunds.ts, credits
 *            the customer's wallet through the existing Finance ledger.
 *          - a pending additional charge (final > captured) -> a NEW
 *            order_additional_charges row the customer must explicitly
 *            pay (confirmAdditionalChargePayment below) — the higher
 *            amount is NEVER silently added to an already-settled
 *            transaction, exactly as spec section 12 requires.
 *
 * Every step records estimated quantity, actual quantity, actor,
 * timestamp, reason (spec section 13) — the actor/timestamp/reason were
 * already captured on order_items by transitionOrderItemStatus
 * (fulfilled_by_user_id/fulfilled_at/weight_adjustment_reason, migration
 * 0040); this module adds the amount-side settlement on top.
 */
import { createAndExecuteRefund, RefundError } from './refunds'
import { debitWallet, InsufficientFundsError } from './wallet'

export class SettlementError extends Error {}

interface OrderItemForSettlement {
  id: number
  order_id: number
  vendor_id: number
  listing_id: number
  quantity: number
  unit_price_kobo: number
  line_total_kobo: number
  final_price_kobo: number | null
  fulfilled_quantity: number | null
  settlement_status: string
}

/**
 * Compares an already-fulfilled variable-weight item's final_price_kobo
 * against the amount originally captured (line_total_kobo) and settles
 * the difference. Idempotent: a second call on an already-settled item
 * (settlement_status != 'none') is a documented no-op rather than a
 * silent double-refund/double-charge.
 *
 * Returns a description of what happened for the caller to surface to
 * the customer/seller.
 */
export async function settleVariableWeightItem(
  db: D1Database,
  orderItemId: number,
  actorUserId: number
): Promise<{ outcome: 'no_adjustment' | 'refund_issued' | 'additional_charge_created' | 'already_settled'; differenceKobo: number }> {
  const item = await db
    .prepare('SELECT id, order_id, vendor_id, listing_id, quantity, unit_price_kobo, line_total_kobo, final_price_kobo, fulfilled_quantity, settlement_status FROM order_items WHERE id = ?')
    .bind(orderItemId)
    .first<OrderItemForSettlement>()
  if (!item) throw new SettlementError('Order item not found')
  if (item.final_price_kobo === null || item.fulfilled_quantity === null) {
    throw new SettlementError('Item has not been fulfilled with an actual quantity yet — nothing to settle')
  }
  if (item.settlement_status !== 'none') {
    return { outcome: 'already_settled', differenceKobo: 0 }
  }

  const differenceKobo = item.final_price_kobo - item.line_total_kobo

  if (differenceKobo === 0) {
    await db.prepare(`UPDATE order_items SET settlement_status = 'settled' WHERE id = ?`).bind(orderItemId).run()
    return { outcome: 'no_adjustment', differenceKobo: 0 }
  }

  if (differenceKobo < 0) {
    // Final amount LOWER than captured — issue a refund through the
    // existing Finance ledger (never a direct wallet_ledger write here).
    try {
      await createAndExecuteRefund(db, {
        orderId: item.order_id,
        orderItemId: item.id,
        amountKobo: Math.abs(differenceKobo),
        reason: `Variable-weight adjustment: fulfilled ${item.fulfilled_quantity} vs ordered ${item.quantity} — final amount lower than captured`,
        refundType: 'quantity',
        initiatedByUserId: actorUserId,
        initiatedByRole: 'seller',
      })
    } catch (err) {
      if (err instanceof RefundError) throw new SettlementError(err.message)
      throw err
    }
    await db.prepare(`UPDATE order_items SET settlement_status = 'refund_issued' WHERE id = ?`).bind(orderItemId).run()
    return { outcome: 'refund_issued', differenceKobo }
  }

  // differenceKobo > 0: final amount HIGHER than captured. Never silently
  // increase the customer's charge — create a pending additional-charge
  // row the customer must explicitly confirm/pay (spec section 12).
  await db
    .prepare(
      `INSERT INTO order_additional_charges (order_id, order_item_id, amount_kobo, reason, requested_by_user_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(item.order_id, item.id, differenceKobo, `Variable-weight adjustment: fulfilled ${item.fulfilled_quantity} vs ordered ${item.quantity} — additional payment required`, actorUserId)
    .run()
  await db.prepare(`UPDATE order_items SET settlement_status = 'additional_payment_pending' WHERE id = ?`).bind(orderItemId).run()
  return { outcome: 'additional_charge_created', differenceKobo }
}

/** Customer-facing: pending additional charges awaiting their explicit confirmation, scoped by the order's own user_id. */
export async function getPendingAdditionalCharges(db: D1Database, userId: number, orderId: number) {
  const { results } = await db
    .prepare(
      `SELECT ac.* FROM order_additional_charges ac
       JOIN orders o ON o.id = ac.order_id
       WHERE ac.order_id = ? AND o.user_id = ? AND ac.status = 'pending_payment'`
    )
    .bind(orderId, userId)
    .all()
  return results
}

/**
 * Customer explicitly pays a pending additional charge from their wallet.
 * This is the "authorized additional-payment mechanism" spec section 12
 * requires — the amount is never auto-debited without this explicit call.
 */
export async function confirmAdditionalChargePayment(db: D1Database, userId: number, chargeId: number): Promise<{ newBalanceKobo: number }> {
  const charge = await db
    .prepare(
      `SELECT ac.* FROM order_additional_charges ac
       JOIN orders o ON o.id = ac.order_id
       WHERE ac.id = ? AND o.user_id = ? AND ac.status = 'pending_payment'`
    )
    .bind(chargeId, userId)
    .first<{ id: number; order_id: number; order_item_id: number; amount_kobo: number }>()
  if (!charge) throw new SettlementError('Additional charge not found, not yours, or already paid')

  let newBalanceKobo: number
  try {
    newBalanceKobo = await debitWallet(
      db,
      userId,
      charge.amount_kobo,
      'order_additional_charge',
      String(charge.order_id),
      `Additional charge for order #${charge.order_id} (variable-weight adjustment)`
    )
  } catch (err) {
    if (err instanceof InsufficientFundsError) throw new SettlementError('Insufficient wallet balance to pay this additional charge')
    throw err
  }

  const ledgerRow = await db
    .prepare(`SELECT id FROM wallet_ledger WHERE user_id = ? AND reference_type = 'order_additional_charge' AND reference_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(userId, String(charge.order_id))
    .first<{ id: number }>()

  await db.batch([
    db.prepare(`UPDATE order_additional_charges SET status = 'paid', wallet_ledger_id = ?, paid_at = datetime('now') WHERE id = ?`).bind(ledgerRow?.id ?? null, chargeId),
    db.prepare(`UPDATE order_items SET settlement_status = 'additional_payment_paid' WHERE id = ?`).bind(charge.order_item_id),
  ])

  return { newBalanceKobo }
}
