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

/** Validates a coupon code against the given subtotal and returns the discount it would apply. Real rules, real math — not a decorative input. */
export async function validateCoupon(db: D1Database, code: string, subtotalKobo: number): Promise<CouponValidationResult> {
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
    return { valid: false, error: `This coupon requires a minimum order of ₦${(coupon.min_order_kobo / 100).toLocaleString('en-NG')}` }
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

export async function incrementCouponUsage(db: D1Database, couponId: number): Promise<void> {
  await db.prepare('UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?').bind(couponId).run()
}
