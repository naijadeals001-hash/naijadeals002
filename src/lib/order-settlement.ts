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
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 3 — G-5, see
 * docs/ENGINE-7-PHASE-3-VARIABLE-WEIGHT-SETTLEMENT-AUDIT.md for the full
 * forensic writeup): the prior implementation read `item.settlement_status`,
 * branched on it in application code (`if settlement_status !== 'none'
 * return already_settled`), and only THEN performed an UNCONDITIONAL
 * `UPDATE order_items SET settlement_status = ...` — the exact
 * read-then-branch TOCTOU class already fixed for G-2 (webhook) and G-3
 * (order payment). Two concurrent settleVariableWeightItem() calls for the
 * SAME orderItemId could both read settlement_status='none', both pass the
 * guard, and both proceed to execute a financial side effect: for the
 * refund branch this meant two `refunds` rows / two wallet credits for one
 * settlement event (G-4's aggregate cap eventually rejects the second, but
 * only after the wrong number of refund attempts already ran); for the
 * additional-charge branch — which has NO aggregate guard, since it is a
 * customer-owed charge, not a refund — this meant two independent
 * `order_additional_charges` rows for the same shortfall, each payable
 * (confirmAdditionalChargePayment had no de-dup of its own either), a real
 * double-charge risk.
 *
 * WHY NOT G-4's AGGREGATE-CONSTRAINT PATTERN: unlike refunds (many rows may
 * legitimately sum to a cap), an order_item has exactly ONE legitimate
 * settlement outcome ever — this is a SINGLE-ROW, single-transition
 * invariant, structurally identical to G-2/G-3's enum-CAS shape, not G-4's
 * aggregate shape. The correct fix is a guarded CAS claim, not a guarded
 * aggregate INSERT.
 *
 * WHY NOT A PLAIN TWO-STATE CAS (unlike G-2/G-3's unpaid->escrow_held): the
 * terminal settlement_status value ('settled' / 'refund_issued' /
 * 'additional_payment_pending') isn't known until AFTER the claim is won —
 * it depends on differenceKobo, computed from data read before the claim.
 * So the claim uses a transient THIRD state, 'settling' (no CHECK
 * constraint exists on this column — introducing a new legal value needs
 * no migration): `UPDATE ... SET settlement_status='settling' WHERE
 * settlement_status='none'` is the ONE atomic gate two concurrent callers
 * race on — only one can ever see rows_written > 0. The loser is treated
 * identically to "already settled" (accurate either way: someone else is
 * handling this item's settlement, or already has). The winner computes
 * the outcome, executes the SINGLE financial side effect exactly once, then
 * transitions 'settling' -> the correct terminal value (itself guarded by
 * `WHERE settlement_status = 'settling'`, mirroring claim ownership all the
 * way through), rolling back to 'none' if the side effect throws — mirrors
 * Unit 4/5's claim-then-rollback-on-failure precedent exactly, so a
 * genuinely failed attempt (e.g. RefundError, a transient DB error) can be
 * legitimately retried rather than leaving the item stuck mid-settlement
 * forever.
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
 * ATOMIC CLAIM for settlement ownership of a single order_item.
 *
 * `UPDATE ... WHERE settlement_status = 'none'` re-checks the guard AT
 * WRITE TIME (D1/SQLite executes a single UPDATE statement's read-and-write
 * as one indivisible unit), not at an earlier read time — so of any number
 * of concurrent/duplicate callers for the SAME orderItemId, only ONE can
 * ever see `rows_written > 0`. Every loser must treat this identically to
 * "already settled" — never re-run the financial side effect. This is the
 * exact enum-CAS shape proven in resolveDispute()/claimOrderForPayment(),
 * applied to settlement_status's three-way outcome instead of a two-way one
 * — see this module's header comment for why the two-way boolean CAS
 * shape needed a transient third state ('settling') here.
 */
async function claimSettlementSlot(db: D1Database, orderItemId: number): Promise<boolean> {
  const claim = await db
    .prepare(`UPDATE order_items SET settlement_status = 'settling' WHERE id = ? AND settlement_status = 'none'`)
    .bind(orderItemId)
    .run()
  return (claim.meta.rows_written ?? 0) > 0
}

/**
 * Compares an already-fulfilled variable-weight item's final_price_kobo
 * against the amount originally captured (line_total_kobo) and settles
 * the difference. Idempotent: a second call on an already-settled (or
 * currently-settling) item is a documented no-op rather than a silent
 * double-refund/double-charge — now enforced ATOMICALLY via
 * claimSettlementSlot() rather than a read-then-branch check (Engine 7
 * Phase 3 — G-5, see this module's header comment for the full rationale).
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

  // ATOMIC CLAIM FIRST — see claimSettlementSlot()'s header comment. A
  // pre-check read (`item.settlement_status !== 'none'`) is intentionally
  // NOT used to gate anything here (that would just reintroduce the exact
  // TOCTOU this fix exists to close); the claim's own rows_written is the
  // ONLY thing that decides whether this call proceeds.
  const won = await claimSettlementSlot(db, orderItemId)
  if (!won) {
    return { outcome: 'already_settled', differenceKobo: 0 }
  }

  const differenceKobo = item.final_price_kobo - item.line_total_kobo

  try {
    if (differenceKobo === 0) {
      await db
        .prepare(`UPDATE order_items SET settlement_status = 'settled' WHERE id = ? AND settlement_status = 'settling'`)
        .bind(orderItemId)
        .run()
      return { outcome: 'no_adjustment', differenceKobo: 0 }
    }

    if (differenceKobo < 0) {
      // Final amount LOWER than captured — issue a refund through the
      // existing Finance ledger (never a direct wallet_ledger write here).
      // This settlement claim already guarantees this branch executes at
      // most once per item; G-4's aggregate refund guard (refunds.ts)
      // remains in place underneath as defense-in-depth, not as the
      // primary guard for THIS race.
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
      await db
        .prepare(`UPDATE order_items SET settlement_status = 'refund_issued' WHERE id = ? AND settlement_status = 'settling'`)
        .bind(orderItemId)
        .run()
      return { outcome: 'refund_issued', differenceKobo }
    }

    // differenceKobo > 0: final amount HIGHER than captured. Never silently
    // increase the customer's charge — create a pending additional-charge
    // row the customer must explicitly confirm/pay (spec section 12). The
    // settlement claim above is what guarantees only ONE such row is ever
    // created per item, closing the pre-Phase-3 duplicate-charge risk.
    await db
      .prepare(
        `INSERT INTO order_additional_charges (order_id, order_item_id, amount_kobo, reason, requested_by_user_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(item.order_id, item.id, differenceKobo, `Variable-weight adjustment: fulfilled ${item.fulfilled_quantity} vs ordered ${item.quantity} — additional payment required`, actorUserId)
      .run()
    await db
      .prepare(`UPDATE order_items SET settlement_status = 'additional_payment_pending' WHERE id = ? AND settlement_status = 'settling'`)
      .bind(orderItemId)
      .run()
    return { outcome: 'additional_charge_created', differenceKobo }
  } catch (err) {
    // The financial side effect failed AFTER the claim was won — roll the
    // claim back to 'none' so this item is never left stuck 'settling'
    // forever with no refund, no charge, and no way to legitimately retry.
    // Mirrors Unit 4/5's exact claim-then-rollback-on-failure guarantee.
    // Guarded by `AND settlement_status = 'settling'` so a rollback can
    // never clobber a state a (impossible, but guarded per convention)
    // different successful path already advanced past 'settling'.
    await db
      .prepare(`UPDATE order_items SET settlement_status = 'none' WHERE id = ? AND settlement_status = 'settling'`)
      .bind(orderItemId)
      .run()
    throw err
  }
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
 * ATOMIC CLAIM for a pending additional charge's payment. `status` has a DB
 * CHECK constraint restricting it to ('pending_payment', 'paid',
 * 'cancelled') — unlike settlement_status, there is no room (and no need)
 * for a transient third state here: claiming straight to the terminal
 * 'paid' value before debiting mirrors claimOrderForPayment()'s exact
 * two-state CAS shape (Engine 7 Phase 2, Unit 4). Currently unreachable via
 * any HTTP route (confirmAdditionalChargePayment has zero live callers as
 * of Phase 3 — confirmed by repo-wide grep), but hardened to the same
 * standard as every other financial claim in this codebase so it is safe
 * the moment a route is wired to it.
 */
async function claimAdditionalChargeForPayment(db: D1Database, chargeId: number, userId: number): Promise<{ orderItemId: number; amountKobo: number; orderId: number } | null> {
  const charge = await db
    .prepare(
      `SELECT ac.order_id, ac.order_item_id, ac.amount_kobo FROM order_additional_charges ac
       JOIN orders o ON o.id = ac.order_id
       WHERE ac.id = ? AND o.user_id = ? AND ac.status = 'pending_payment'`
    )
    .bind(chargeId, userId)
    .first<{ order_id: number; order_item_id: number; amount_kobo: number }>()
  if (!charge) return null

  const claim = await db
    .prepare(`UPDATE order_additional_charges SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status = 'pending_payment'`)
    .bind(chargeId)
    .run()
  if ((claim.meta.rows_written ?? 0) === 0) return null

  return { orderItemId: charge.order_item_id, amountKobo: charge.amount_kobo, orderId: charge.order_id }
}

/**
 * Customer explicitly pays a pending additional charge from their wallet.
 * This is the "authorized additional-payment mechanism" spec section 12
 * requires — the amount is never auto-debited without this explicit call.
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 3 — G-5, claim-before-debit
 * ordering, mirroring payOrderFromWallet()'s Unit 4 fix and
 * createAndExecuteRefund()'s Unit 5 fix): the prior implementation read
 * the charge row, branched on `status = 'pending_payment'`, THEN debited
 * the wallet, THEN performed an unconditional UPDATE to 'paid' — the same
 * read-then-branch race as every other pre-Phase-3/pre-Phase-2 financial
 * function in this codebase. Two concurrent calls for the SAME chargeId
 * could both pass the read-based guard and both debit the customer's
 * wallet for the same charge. The fix claims the charge (CAS straight to
 * 'paid') FIRST, and only debits if that claim actually won; if the debit
 * then fails (insufficient funds), the claim is rolled back to
 * 'pending_payment' so the customer can legitimately retry after topping
 * up — never left silently 'paid' with no money moved, and never left
 * un-payable after a transient failure.
 */
export async function confirmAdditionalChargePayment(db: D1Database, userId: number, chargeId: number): Promise<{ newBalanceKobo: number }> {
  const claimed = await claimAdditionalChargeForPayment(db, chargeId, userId)
  if (!claimed) throw new SettlementError('Additional charge not found, not yours, or already paid')

  let newBalanceKobo: number
  try {
    // reference_id is the charge's OWN id (not the bare orderId) so that
    // TWO charges against the SAME order can never collide on the same
    // reference_id — mirrors createAndExecuteRefund()'s identical Unit 5
    // traceability fix.
    newBalanceKobo = await debitWallet(
      db,
      userId,
      claimed.amountKobo,
      'order_additional_charge',
      String(chargeId),
      `Additional charge for order #${claimed.orderId} (variable-weight adjustment)`
    )
  } catch (err) {
    // Debit failed AFTER the claim succeeded — roll the claim back to
    // 'pending_payment' so the charge is never left silently 'paid' with
    // no money actually moved, and remains legitimately payable again.
    await db
      .prepare(`UPDATE order_additional_charges SET status = 'pending_payment', paid_at = NULL WHERE id = ? AND status = 'paid'`)
      .bind(chargeId)
      .run()
    if (err instanceof InsufficientFundsError) throw new SettlementError('Insufficient wallet balance to pay this additional charge')
    throw err
  }

  const ledgerRow = await db
    .prepare(`SELECT id FROM wallet_ledger WHERE user_id = ? AND reference_type = 'order_additional_charge' AND reference_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(userId, String(chargeId))
    .first<{ id: number }>()

  await db.batch([
    db.prepare(`UPDATE order_additional_charges SET wallet_ledger_id = ? WHERE id = ?`).bind(ledgerRow?.id ?? null, chargeId),
    db.prepare(`UPDATE order_items SET settlement_status = 'additional_payment_paid' WHERE id = ?`).bind(claimed.orderItemId),
  ])

  return { newBalanceKobo }
}
