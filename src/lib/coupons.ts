import { formatMoney } from './money'

export interface CouponRow {
  id: number
  code: string
  description: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  min_order_kobo: number
  max_discount_kobo: number | null
  expires_at: string | null
  is_active: number
  usage_limit: number | null
  usage_count: number
}

export interface CouponValidationResult {
  valid: boolean
  error?: string
  coupon?: CouponRow
  discountKobo?: number
}

/**
 * Validates a coupon code against the given subtotal and returns the discount it would apply.
 * Real rules, real math — not a decorative input.
 *
 * `currency` (Stage 2C: Currency & Address Foundation) is used ONLY to format the
 * minimum-order error message in the cart's own currency instead of a hardcoded ₦ —
 * it does NOT change the discount math itself, which still operates on the raw
 * combined subtotalKobo exactly as before (cross-currency coupon math is explicitly
 * out of scope for this stage; the caller passes whichever currency is most
 * representative of the cart, defaulting to 'NGN').
 */
export async function validateCoupon(db: D1Database, code: string, subtotalKobo: number, currency: string = 'NGN'): Promise<CouponValidationResult> {
  const coupon = await db
    .prepare('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE')
    .bind(code.trim())
    .first<CouponRow>()

  if (!coupon) return { valid: false, error: 'Coupon code not found' }
  if (!coupon.is_active) return { valid: false, error: 'This coupon is no longer active' }
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { valid: false, error: 'This coupon has expired' }
  }
  if (coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit) {
    return { valid: false, error: 'This coupon has reached its usage limit' }
  }
  if (subtotalKobo < coupon.min_order_kobo) {
    return { valid: false, error: `This coupon requires a minimum order of ${formatMoney(coupon.min_order_kobo, currency)}` }
  }

  let discountKobo = coupon.discount_type === 'percent'
    ? Math.round((subtotalKobo * coupon.discount_value) / 100)
    : coupon.discount_value

  if (coupon.max_discount_kobo !== null) {
    discountKobo = Math.min(discountKobo, coupon.max_discount_kobo)
  }
  discountKobo = Math.min(discountKobo, subtotalKobo)

  return { valid: true, coupon, discountKobo }
}

/**
 * CONCURRENCY HARDENING (Engine 12 Phase 0 audit finding, remediated here —
 * see docs/ENGINE-12-PROMOTION-ADVERTISING-GAP-MATRIX.md §4.5 and
 * docs/ENGINE-12-LEGACY-REMEDIATION.md for the full forensic writeup):
 *
 * PRIOR implementation (pre-remediation) was a plain, unguarded
 * `UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?` called
 * AFTER validateCoupon() had already done its own separate SELECT-based
 * check. This is the exact "check-then-act" TOCTOU race wallet.ts's own
 * doc comment (src/lib/wallet.ts lines 1-90) describes as the bug class
 * already fixed once for wallet balances: N concurrent callers can all
 * pass the SELECT-based validateCoupon() check against the SAME
 * pre-mutation usage_count, then all successfully run their own
 * increment, collectively exceeding usage_limit by however many callers
 * raced. Reproduced deliberately during the Phase 0 audit: 10 concurrent
 * redemption attempts against a coupon with usage_limit=1 all succeeded,
 * pushing usage_count to 10 — confirmed twice, not a fluke.
 *
 * FIX (this function, renamed from incrementCouponUsage to
 * claimCouponUsage to make the changed contract explicit — it now
 * returns a boolean claim result instead of assuming success):
 * the usage-limit re-check moves INTO the UPDATE's own WHERE clause,
 * re-evaluated AT WRITE TIME against whatever row state actually exists
 * the instant this statement runs — not against an earlier SELECT's
 * potentially-stale snapshot. This is the exact CAS (compare-and-swap)
 * generalization already proven correct elsewhere in this codebase:
 *   - booking-lifecycle.ts's transitionBooking() / booking-payments.ts's
 *     payForBooking(): `WHERE status = 'expected-old-enum-value'`
 *   - orders.ts's claimOrderForPayment(): `WHERE payment_status = 'unpaid'`
 *   - wallet.ts's debitWallet(): `WHERE cached_balance_kobo >= ?`
 * Coupon usage is the same "claim only if the current state still
 * satisfies the invariant" idea, generalized to
 * `WHERE usage_limit IS NULL OR usage_count < usage_limit`. Also
 * re-checks `is_active` and `expires_at` in the same guarded statement,
 * for the same reason claimOrderForPayment() re-checks payment_status
 * rather than trusting an earlier read: only the state AT THE MOMENT OF
 * THE WRITE is authoritative — a coupon could theoretically be
 * deactivated or expire in the (tiny) gap between validateCoupon()'s
 * SELECT and this claim.
 *
 * `rows_written` (D1PreparedStatement.run().meta.rows_written), not
 * UPDATE...RETURNING, for the same two reasons wallet.ts's doc comment
 * gives (no independently-confirmed RETURNING-parity guarantee across
 * every D1 storage backend in production; rows_written is the exact
 * mechanism every other CAS claim in this codebase already uses and has
 * been proven correct under real concurrent load).
 *
 * Returns true iff THIS call's claim won (i.e. the increment happened
 * and the caller may treat the coupon as successfully, exclusively
 * redeemed by this order). Returns false if the coupon was exhausted,
 * deactivated, or expired at the exact moment of the write — the caller
 * (createPendingOrder in orders.ts) treats a false result exactly like
 * an invalid coupon: proceed without a discount rather than blocking
 * checkout, per the pre-existing documented fallback behavior.
 *
 * CANCELLATION POLICY (explicit product decision — see
 * docs/ENGINE-12-LEGACY-REMEDIATION.md §1 for full rationale):
 * usage_count is claimed here at successful order-creation time and is
 * intentionally NEVER decremented anywhere in this codebase, including
 * on order cancellation/abandonment (orders.ts's cancelOrder() does not
 * call any coupon-releasing function — confirmed by design, not
 * oversight). usage_limit is a limit on REDEMPTIONS (successful
 * order-creation events), not on COMPLETED FULFILLMENTS. This is a
 * deliberate anti-abuse choice (prevents cancel/reorder cycling through
 * a scarce coupon) and a deliberate simplicity choice (no
 * reservation/release accounting subsystem, no second concurrency
 * surface to harden). If a future commercial need requires releasing
 * slots on cancellation, that must be implemented as an explicit,
 * separately-audited reservation-vs-redemption model — never as a bare
 * decrement bolted onto cancelOrder().
 */
export async function claimCouponUsage(db: D1Database, couponId: number): Promise<boolean> {
  const claim = await db
    .prepare(
      `UPDATE coupons
       SET usage_count = usage_count + 1
       WHERE id = ?
         AND is_active = 1
         AND (expires_at IS NULL OR expires_at > datetime('now'))
         AND (usage_limit IS NULL OR usage_count < usage_limit)`
    )
    .bind(couponId)
    .run()
  return (claim.meta.rows_written ?? 0) > 0
}
