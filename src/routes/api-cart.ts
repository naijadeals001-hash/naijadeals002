import { Hono } from 'hono'
import type { AppEnv, CartItemRow } from '../types'
import { getOrCreateCartId, getCartItems, getSavedForLaterItems, addToCart, updateCartItemQuantity, removeFromCart, setSavedForLater, groupByVendor, groupByCurrency, getBuyNowItem } from '../lib/cart'
import { getOrSetGuestToken } from '../lib/guest'
import { validateCoupon } from '../lib/coupons'
import { calculateDeliveryFeeKobo, type DeliveryMethod } from '../lib/orders'

export const cartApi = new Hono<AppEnv>()

async function resolveCartId(c: any): Promise<number> {
  const user = c.get('user')
  const guestToken = user ? null : getOrSetGuestToken(c)
  return getOrCreateCartId(c.env.DB, user?.id ?? null, guestToken)
}

/**
 * Stage 2C (Currency & Address Foundation): every AJAX-consumed cart summary
 * now also carries a per-currency breakdown (`currency_groups`) alongside the
 * pre-existing single `subtotal_kobo` figure. `subtotal_kobo` is UNCHANGED —
 * it remains the raw combined total across all currencies (order/payment
 * math semantics are explicitly untouched by this stage) — but the frontend
 * (public/static/app.js) must render `currency_groups` instead of formatting
 * `subtotal_kobo` as a single ₦ amount whenever more than one group is
 * present, exactly mirroring the server-rendered cart.tsx behavior. This is
 * the fix for the confirmed client-side AJAX currency-collapse gap.
 */
function summarize(items: Awaited<ReturnType<typeof getCartItems>>) {
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  const count = items.reduce((s, i) => s + i.quantity, 0)
  const sellerCount = new Set(items.map((i) => i.vendor_id)).size
  const currencyGroups = Array.from(groupByCurrency(items).entries()).map(([currency, g]) => ({
    currency,
    subtotal_kobo: g.subtotalMinor,
    item_count: g.items.length
  }))
  return {
    subtotal_kobo: subtotal,
    count,
    seller_count: sellerCount,
    currency_groups: currencyGroups,
    is_multi_currency: currencyGroups.length > 1
  }
}

cartApi.get('/', async (c) => {
  const cartId = await resolveCartId(c)
  const items = await getCartItems(c.env.DB, cartId)
  const saved = await getSavedForLaterItems(c.env.DB, cartId)
  return c.json({ items, saved, ...summarize(items) })
})

cartApi.post('/items', async (c) => {
  const body = await c.req.json<{ listing_id: number; quantity?: number; variant_id?: number }>().catch(() => null)
  if (!body?.listing_id) return c.json({ error: 'listing_id required' }, 400)

  const listing = await c.env.DB.prepare('SELECT id, stock FROM product_listings WHERE id = ? AND is_active = 1')
    .bind(body.listing_id)
    .first<{ id: number; stock: number }>()
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  if (listing.stock <= 0) return c.json({ error: 'Out of stock' }, 400)

  const cartId = await resolveCartId(c)
  await addToCart(c.env.DB, cartId, body.listing_id, Math.max(1, body.quantity ?? 1), body.variant_id ?? null)
  const items = await getCartItems(c.env.DB, cartId)
  return c.json({ success: true, ...summarize(items) })
})

cartApi.put('/items/:cartItemId', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const body = await c.req.json<{ quantity: number }>().catch(() => null)
  if (body?.quantity === undefined) return c.json({ error: 'quantity required' }, 400)

  const cartId = await resolveCartId(c)
  await updateCartItemQuantity(c.env.DB, cartId, cartItemId, body.quantity)
  const items = await getCartItems(c.env.DB, cartId)
  return c.json({ items, ...summarize(items) })
})

cartApi.delete('/items/:cartItemId', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const cartId = await resolveCartId(c)
  await removeFromCart(c.env.DB, cartId, cartItemId)
  const items = await getCartItems(c.env.DB, cartId)
  return c.json({ items, ...summarize(items) })
})

cartApi.post('/items/:cartItemId/save-for-later', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const cartId = await resolveCartId(c)
  await setSavedForLater(c.env.DB, cartId, cartItemId, true)
  const items = await getCartItems(c.env.DB, cartId)
  const saved = await getSavedForLaterItems(c.env.DB, cartId)
  return c.json({ items, saved, ...summarize(items) })
})

cartApi.post('/items/:cartItemId/move-to-cart', async (c) => {
  const cartItemId = Number(c.req.param('cartItemId'))
  const cartId = await resolveCartId(c)
  await setSavedForLater(c.env.DB, cartId, cartItemId, false)
  const items = await getCartItems(c.env.DB, cartId)
  const saved = await getSavedForLaterItems(c.env.DB, cartId)
  return c.json({ items, saved, ...summarize(items) })
})

cartApi.delete('/items/:cartItemId/saved', async (c) => {
  // Permanently remove a saved-for-later item (distinct from moving it back to the active cart).
  const cartItemId = Number(c.req.param('cartItemId'))
  const cartId = await resolveCartId(c)
  await removeFromCart(c.env.DB, cartId, cartItemId)
  const saved = await getSavedForLaterItems(c.env.DB, cartId)
  return c.json({ saved })
})

/**
 * Live coupon + delivery-method preview for the checkout summary panel — recalculates against the
 * CURRENT cart (or, for the Buy Now flow, a single fresh-resolved listing), not a client-guessed
 * number, so the total shown always matches what the order will actually charge.
 */
cartApi.post('/preview', async (c) => {
  const body = await c.req
    .json<{ coupon_code?: string; delivery_method?: DeliveryMethod; buy_now?: { listing_id: number; quantity: number; variant_id?: number | null } }>()
    .catch(() => ({}))

  let items: CartItemRow[]
  if (body.buy_now) {
    const item = await getBuyNowItem(c.env.DB, Number(body.buy_now.listing_id), Math.max(1, Number(body.buy_now.quantity) || 1), body.buy_now.variant_id ?? null)
    items = item ? [item] : []
  } else {
    const cartId = await resolveCartId(c)
    items = await getCartItems(c.env.DB, cartId)
  }
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  const deliveryMethod: DeliveryMethod = body.delivery_method === 'express' ? 'express' : 'standard'
  const deliveryFee = calculateDeliveryFeeKobo(items, deliveryMethod)

  let discountKobo = 0
  let couponError: string | null = null
  let couponValid = false
  if (body.coupon_code) {
    const validation = await validateCoupon(c.env.DB, body.coupon_code, subtotal, items[0]?.currency ?? 'NGN')
    if (validation.valid) {
      discountKobo = validation.discountKobo ?? 0
      couponValid = true
    } else {
      couponError = validation.error ?? 'Invalid coupon'
    }
  }

  const total = Math.max(0, subtotal + deliveryFee - discountKobo)
  const sellers = Array.from(groupByVendor(items).entries()).map(([vendorId, g]) => ({
    vendor_id: vendorId,
    vendor_name: g.vendorName,
    item_count: g.items.length
  }))
  // Stage 2C: same per-currency breakdown as summarize() above, so the
  // checkout summary panel's live AJAX preview (delivery method / coupon
  // recalculation) never collapses a multi-currency cart into one ₦ figure.
  const currencyGroups = Array.from(groupByCurrency(items).entries()).map(([currency, g]) => ({
    currency,
    subtotal_kobo: g.subtotalMinor,
    item_count: g.items.length
  }))

  return c.json({
    subtotal_kobo: subtotal,
    delivery_fee_kobo: deliveryFee,
    discount_kobo: discountKobo,
    total_kobo: total,
    seller_count: sellers.length,
    sellers,
    coupon_valid: couponValid,
    coupon_error: couponError,
    currency_groups: currencyGroups,
    is_multi_currency: currencyGroups.length > 1
  })
})
