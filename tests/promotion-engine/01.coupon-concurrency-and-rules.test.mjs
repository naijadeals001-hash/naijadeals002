/**
 * Promotion Engine — Engine 12 Legacy Remediation, Unit 1: Coupon concurrency
 * hardening + discount rule regression.
 *
 * Exercises validateCoupon()/claimCouponUsage() in src/lib/coupons.ts DIRECTLY,
 * in-process, against the real local D1 binding (see helpers/db.mjs's header
 * comment for why this harness talks to the DB one layer below HTTP).
 *
 * Genuine concurrency is exercised via Promise.all — real parallel async calls
 * into the SAME D1 binding a live Worker request would use, matching
 * payment-engine's 01.wallet-concurrency.test.mjs and booking-engine's
 * 05.concurrency.test.mjs methodology. NOT mocked, NOT simulated sequentially.
 *
 * COUPON CANCELLATION POLICY UNDER TEST (explicit product decision, see
 * docs/ENGINE-12-LEGACY-REMEDIATION.md §1): usage_count is claimed at
 * successful order-creation/redemption and is NEVER released on cancellation/
 * abandonment. usage_limit is a limit on REDEMPTIONS, not on completed
 * fulfillments. This suite proves that policy is actually what the code does
 * (Test 11), not merely documented intent.
 *
 * Run TWICE per this program's established "run the targeted suite at least
 * twice" protocol for any concurrency-sensitive fix:
 *   node --experimental-strip-types --test tests/promotion-engine/01.coupon-concurrency-and-rules.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, createTestCoupon, cleanupTestCoupons, disposeTestDb } from './helpers/db.mjs'
import { validateCoupon, claimCouponUsage } from '../../src/lib/coupons.ts'
import { createPendingOrder } from '../../src/lib/orders.ts'

test.after(async () => {
  await cleanupTestCoupons()
  await disposeTestDb()
})

// ---------- 1. Percentage discount ----------
test('percentage discount: computes the correct rounded kobo amount', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'pct', { discount_type: 'percent', discount_value: 10 })
  const result = await validateCoupon(db, code, 500000) // ₦5,000 subtotal
  assert.equal(result.valid, true)
  assert.equal(result.discountKobo, 50000) // 10% of ₦5,000 = ₦500
})

// ---------- 2. Fixed discount ----------
test('fixed discount: applies the exact configured kobo amount', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'fixed', { discount_type: 'fixed', discount_value: 150000 })
  const result = await validateCoupon(db, code, 1000000)
  assert.equal(result.valid, true)
  assert.equal(result.discountKobo, 150000)
})

// ---------- 3. Minimum order ----------
test('minimum order: rejects when subtotal is below min_order_kobo', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'minorder', { min_order_kobo: 1000000 })
  const result = await validateCoupon(db, code, 500000)
  assert.equal(result.valid, false)
  assert.match(result.error, /minimum order/i)
})

test('minimum order: accepts when subtotal meets min_order_kobo exactly', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'minorder_exact', { min_order_kobo: 1000000 })
  const result = await validateCoupon(db, code, 1000000)
  assert.equal(result.valid, true)
})

// ---------- 4. Maximum discount ----------
test('maximum discount: percentage discount is capped at max_discount_kobo', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'maxdisc', { discount_type: 'percent', discount_value: 50, max_discount_kobo: 100000 })
  const result = await validateCoupon(db, code, 10000000) // 50% of ₦100,000 would be ₦50,000 -> capped at ₦1,000
  assert.equal(result.valid, true)
  assert.equal(result.discountKobo, 100000)
})

test('maximum discount: discount never exceeds the subtotal itself', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'overcap', { discount_type: 'fixed', discount_value: 900000 })
  const result = await validateCoupon(db, code, 500000)
  assert.equal(result.valid, true)
  assert.equal(result.discountKobo, 500000, 'discount must never exceed the subtotal it is applied to')
})

// ---------- 5. Expiration ----------
test('expiration: rejects a coupon whose expires_at is in the past', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'expired', { expires_at: '2020-01-01 00:00:00' })
  const result = await validateCoupon(db, code, 500000)
  assert.equal(result.valid, false)
  assert.match(result.error, /expired/i)
})

test('expiration: accepts a coupon whose expires_at is in the future', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'future_exp', { expires_at: '2099-01-01 00:00:00' })
  const result = await validateCoupon(db, code, 500000)
  assert.equal(result.valid, true)
})

// ---------- 6 & 7. Usage limit + exhausted coupon ----------
test('usage limit: rejects once usage_count has reached usage_limit', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'exhausted', { usage_limit: 5, usage_count: 5 })
  const result = await validateCoupon(db, code, 500000)
  assert.equal(result.valid, false)
  assert.match(result.error, /usage limit/i)
})

test('usage limit: accepts while usage_count is below usage_limit', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'not_exhausted', { usage_limit: 5, usage_count: 4 })
  const result = await validateCoupon(db, code, 500000)
  assert.equal(result.valid, true)
})

// ---------- 8. Concurrent redemption against limit = 1 (THE headline regression) ----------
test('CONCURRENCY: usage_limit=1 with 10 concurrent claims allows exactly ONE success, no oversubscription', async () => {
  const db = await getTestDb()
  const { id: couponId, code } = await createTestCoupon(db, 'race_limit1', { usage_limit: 1, usage_count: 0 })

  // Real concurrency: 10 genuine parallel async calls into the SAME D1 binding a
  // live Worker request would use — not sequential, not mocked.
  const claims = await Promise.all(Array.from({ length: 10 }, () => claimCouponUsage(db, couponId)))
  const successCount = claims.filter(Boolean).length

  assert.equal(successCount, 1, `expected exactly 1 successful claim out of 10 concurrent attempts, got ${successCount}`)

  const final = await db.prepare('SELECT usage_count, usage_limit FROM coupons WHERE code = ?').bind(code).first()
  assert.equal(final.usage_count, 1, 'usage_count must equal exactly 1, matching the single winning claim')
  assert.ok(final.usage_count <= final.usage_limit, 'usage_count must never exceed usage_limit')
})

// ---------- 9. Concurrent redemption against limit > 1 ----------
test('CONCURRENCY: usage_limit=3 with 10 concurrent claims allows exactly THREE successes, no oversubscription', async () => {
  const db = await getTestDb()
  const { id: couponId, code } = await createTestCoupon(db, 'race_limit3', { usage_limit: 3, usage_count: 0 })

  const claims = await Promise.all(Array.from({ length: 10 }, () => claimCouponUsage(db, couponId)))
  const successCount = claims.filter(Boolean).length

  assert.equal(successCount, 3, `expected exactly 3 successful claims out of 10 concurrent attempts, got ${successCount}`)

  const final = await db.prepare('SELECT usage_count, usage_limit FROM coupons WHERE code = ?').bind(code).first()
  assert.equal(final.usage_count, 3)
  assert.ok(final.usage_count <= final.usage_limit)
})

// ---------- 10. Duplicate / repeated redemption behavior ----------
test('duplicate redemption: claiming an already-exhausted coupon a second time (sequentially) fails cleanly', async () => {
  const db = await getTestDb()
  const { id: couponId } = await createTestCoupon(db, 'dup_redeem', { usage_limit: 1, usage_count: 0 })

  const first = await claimCouponUsage(db, couponId)
  const second = await claimCouponUsage(db, couponId)

  assert.equal(first, true, 'the first claim must succeed')
  assert.equal(second, false, 'a second sequential claim against an exhausted coupon must fail (not silently succeed)')
})

// ---------- 11. Cancelled order does NOT release usage (the explicit product policy) ----------
test('CANCELLATION POLICY: usage claimed by createPendingOrder() is NOT released when that order is later cancelled', async () => {
  const db = await getTestDb()
  const { code } = await createTestCoupon(db, 'cancel_policy', { usage_limit: 1, usage_count: 0, discount_type: 'fixed', discount_value: 50000, min_order_kobo: 0 })

  // Minimal real user + listing fixture so createPendingOrder() has something genuine to insert.
  const userEmail = `promotest_cancelpolicy_${Date.now()}@test.ng`
  const userResult = await db
    .prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .bind(userEmail, 'Cancel Policy Test User', 'test-hash', 'test-salt')
    .run()
  const userId = Number(userResult.meta.last_row_id)

  const listing = await db
    .prepare('SELECT pl.id as listing_id, pl.vendor_id, pl.price_kobo, p.id as product_id, p.title, p.image_url FROM product_listings pl JOIN products p ON p.id = pl.product_id WHERE pl.is_active = 1 LIMIT 1')
    .first()
  assert.ok(listing, 'fixture precondition: at least one active product_listing must exist in the seeded catalog')

  const cartItem = {
    listing_id: listing.listing_id,
    vendor_id: listing.vendor_id,
    price_kobo: listing.price_kobo,
    quantity: 1,
    product_id: listing.product_id,
    title: listing.title,
    image_url: listing.image_url,
    variant_value: null
  }

  const shipping = { name: 'Test User', phone: '08000000000', address: '1 Test Street', city: 'Lagos', state: 'Lagos' }

  const order = await createPendingOrder(db, userId, [cartItem], shipping, 'standard', code)
  assert.equal(order.discountKobo, 50000, 'the coupon must have been successfully claimed and applied to this order')

  const afterCreate = await db.prepare('SELECT usage_count FROM coupons WHERE code = ?').bind(code).first()
  assert.equal(afterCreate.usage_count, 1, 'usage_count must be 1 immediately after order creation')

  // Cancel the order (matches src/lib/orders.ts's cancelOrder() contract: userId + orderId, unpaid orders are cancellable)
  const { cancelOrder } = await import('../../src/lib/orders.ts')
  await cancelOrder(db, userId, order.orderId, 'Test: verifying coupon cancellation policy')

  const afterCancel = await db.prepare('SELECT usage_count FROM coupons WHERE code = ?').bind(code).first()
  assert.equal(afterCancel.usage_count, 1, 'CANCELLATION POLICY: usage_count must remain 1 after cancellation — it must NOT be released back to 0')

  // And a second customer must NOT be able to redeem the now-exhausted coupon, even though the first order was cancelled.
  const secondValidation = await validateCoupon(db, code, 500000)
  assert.equal(secondValidation.valid, false, 'a cancelled order must NOT reopen a coupon slot for a different customer')
  assert.match(secondValidation.error, /usage limit/i)

  // Cleanup this test's own fixture rows (order/order_items/user) — coupon cleanup handled by test.after().
  await db.prepare('DELETE FROM order_items WHERE order_id = ?').bind(order.orderId).run()
  await db.prepare('DELETE FROM orders WHERE id = ?').bind(order.orderId).run()
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
})

// ---------- 12. Unlimited coupon behavior ----------
test('unlimited coupon: usage_limit=NULL allows any number of claims with no CAS rejection', async () => {
  const db = await getTestDb()
  const { id: couponId, code } = await createTestCoupon(db, 'unlimited', { usage_limit: null, usage_count: 0 })

  const claims = await Promise.all(Array.from({ length: 10 }, () => claimCouponUsage(db, couponId)))
  const successCount = claims.filter(Boolean).length

  assert.equal(successCount, 10, 'an unlimited coupon (usage_limit=NULL) must allow all 10 concurrent claims to succeed')

  const final = await db.prepare('SELECT usage_count, usage_limit FROM coupons WHERE code = ?').bind(code).first()
  assert.equal(final.usage_count, 10)
  assert.equal(final.usage_limit, null)
})

// ---------- Bonus: inactive / deactivated coupon cannot be claimed even with room left ----------
test('deactivated coupon: claimCouponUsage() re-checks is_active at write time and rejects even with usage room remaining', async () => {
  const db = await getTestDb()
  const { id: couponId } = await createTestCoupon(db, 'inactive', { usage_limit: 10, usage_count: 0, is_active: 0 })
  const claimed = await claimCouponUsage(db, couponId)
  assert.equal(claimed, false, 'an inactive coupon must never be claimable, regardless of remaining usage room')
})

// ---------- Bonus: expired coupon cannot be claimed even with room left ----------
test('expired coupon: claimCouponUsage() re-checks expires_at at write time and rejects even with usage room remaining', async () => {
  const db = await getTestDb()
  const { id: couponId } = await createTestCoupon(db, 'expired_claim', { usage_limit: 10, usage_count: 0, expires_at: '2020-01-01 00:00:00' })
  const claimed = await claimCouponUsage(db, couponId)
  assert.equal(claimed, false, 'an expired coupon must never be claimable at write time, regardless of remaining usage room')
})
