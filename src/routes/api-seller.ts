/**
 * Seller API — Marketplace Engine 2.0 (spec section 35's example endpoint
 * list). Previously 100% unbuilt (confirmed via grep during the inspection
 * phase) — every one of these was a fake dashboard button or a missing
 * route before this checkpoint.
 *
 * OWNERSHIP RESOLUTION (non-negotiable, spec section 38): `resolveSellerVendor`
 * below is the ONLY way any handler in this file learns "which vendor_id am
 * I acting as". It NEVER reads vendor_id from the client. Two paths:
 *   1. Individual seller: c.get('user').id -> vendors.user_id (mirrors
 *      src/lib/seller.ts's resolveSellerStatus exactly).
 *   2. Organization-owned store: c.get('user').id -> ACTIVE membership in
 *      an organization (resolveMembership) with the 'store.manage'
 *      permission -> vendors.organization_id.
 * If neither resolves, every route below responds 403 — there is no third
 * path and no fallback to a client-supplied identifier.
 */
import { Hono } from 'hono'
import type { AppEnv, VendorRow } from '../types'
import { requireAuth } from '../lib/auth'
import { resolveSellerStatus } from '../lib/seller'
import { resolveMembership } from '../lib/organizations'
import { getVendorForOrganization } from '../lib/stores'
import {
  createProduct,
  findSimilarProducts,
  getProductById,
  sellerOwnsProduct,
  updateProduct,
  createListing,
  getOwnedListing,
  updateListing,
  getListingsForVendor,
  createVariant,
  getOwnedVariant,
  getOrdersForVendor,
  getVendorItemsForOrder,
  updateOrderItemStatus,
} from '../lib/seller-products'
import { adjustStock, getInventoryHistory, computeAvailableQuantity, isLowStock, InsufficientStockError } from '../lib/inventory'
import { replacePricingTiers, getPricingTiersForListing } from '../lib/pricing'
import { recomputeBuyBoxWinner } from '../lib/buybox'
import { transitionOrderItemStatus, OrderLifecycleError, IllegalTransitionError, NotOwnedOrderItemError, type OrderItemStatus } from '../lib/order-lifecycle'
import { settleVariableWeightItem, SettlementError } from '../lib/order-settlement'
import { createDispute, getDisputesForOrder, getRefundsForVendor, RefundError } from '../lib/refunds'
import { validateAndCollectAttributeValues, saveProductAttributeValues, getProductAttributeValues } from '../lib/attributes'
import { setListingCountryAvailability, getListingCountryAvailability } from '../lib/country'
import { getModerationHistoryForVendor } from '../lib/moderation'

export const sellerApi = new Hono<AppEnv>()

sellerApi.use('*', requireAuth)

/**
 * Resolves the acting vendor for the current request from the
 * AUTHENTICATED user only. Tries individual-seller ownership first, then
 * organization-store ownership (via an explicit `?organization_id=` query
 * param that is used ONLY to pick WHICH organization the user claims to
 * act for — resolveMembership still re-verifies that membership
 * server-side, so a value here that doesn't match a real active
 * membership resolves to nothing, exactly like Section 38 requires).
 */
async function resolveSellerVendor(c: any): Promise<VendorRow | null> {
  const user = c.get('user')
  if (!user) return null

  const individual = await resolveSellerStatus(c.env.DB, user.id)
  if (individual.state === 'ACTIVE_SELLER' && individual.vendor) return individual.vendor

  const organizationId = Number(c.req.query('organization_id'))
  if (organizationId && !Number.isNaN(organizationId)) {
    const membership = await resolveMembership(c.env.DB, user.id, organizationId)
    if (membership && membership.permissionKeys.has('store.manage')) {
      const vendor = await getVendorForOrganization(c.env.DB, organizationId)
      if (vendor) return vendor
    }
  }
  return null
}

async function requireSellerVendor(c: any, next: () => Promise<void>) {
  const vendor = await resolveSellerVendor(c)
  if (!vendor) {
    return c.json({ error: 'You do not have an active store. Complete seller onboarding or use an organization store with store.manage permission.' }, 403)
  }
  c.set('sellerVendor', vendor)
  await next()
}

sellerApi.use('*', requireSellerVendor)

function vendorOf(c: any): VendorRow {
  return c.get('sellerVendor') as VendorRow
}

// ---------- Products ----------

sellerApi.get('/products/search-similar', async (c) => {
  const title = c.req.query('title') ?? ''
  const categoryId = c.req.query('category_id') ? Number(c.req.query('category_id')) : undefined
  if (!title.trim()) return c.json({ results: [] })
  const results = await findSimilarProducts(c.env.DB, title, categoryId)
  return c.json({ results })
})

sellerApi.get('/products', async (c) => {
  const vendor = vendorOf(c)
  const results = await getListingsForVendor(c.env.DB, vendor.id, {
    limit: Number(c.req.query('limit') ?? 50),
    offset: Number(c.req.query('offset') ?? 0),
  })
  return c.json({ results })
})

sellerApi.post('/products', async (c) => {
  const vendor = vendorOf(c)
  const body = await c.req.json().catch(() => ({}))
  if (!body.title || !body.category_id || !body.image_url) {
    return c.json({ error: 'title, category_id and image_url are required' }, 400)
  }
  const productId = await createProduct(c.env.DB, {
    category_id: Number(body.category_id),
    brand_id: body.brand_id ? Number(body.brand_id) : null,
    title: String(body.title),
    description: body.description ? String(body.description) : undefined,
    long_description: body.long_description ? String(body.long_description) : undefined,
    specs_json: body.specs_json ? JSON.stringify(body.specs_json) : undefined,
    whats_included_json: body.whats_included_json ? JSON.stringify(body.whats_included_json) : undefined,
    image_url: String(body.image_url),
    gallery_json: body.gallery_json ? JSON.stringify(body.gallery_json) : undefined,
  })
  return c.json({ id: productId, moderation_status: 'pending_review', vendor_id: vendor.id }, 201)
})

sellerApi.patch('/products/:id', async (c) => {
  const vendor = vendorOf(c)
  const productId = Number(c.req.param('id'))
  const owned = await sellerOwnsProduct(c.env.DB, vendor.id, productId)
  if (!owned) return c.json({ error: 'Product not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const input: Record<string, unknown> = {}
  for (const key of ['title', 'description', 'long_description', 'image_url']) {
    if (body[key] !== undefined) input[key] = String(body[key])
  }
  if (body.specs_json !== undefined) input.specs_json = JSON.stringify(body.specs_json)
  if (body.gallery_json !== undefined) input.gallery_json = JSON.stringify(body.gallery_json)

  await updateProduct(c.env.DB, vendor.id, productId, input as any)
  const product = await getProductById(c.env.DB, productId)
  return c.json({ product })
})

// ---------- Listings ----------

sellerApi.post('/listings', async (c) => {
  const vendor = vendorOf(c)
  const body = await c.req.json().catch(() => ({}))
  if (!body.product_id || body.price_kobo === undefined || body.stock === undefined) {
    return c.json({ error: 'product_id, price_kobo and stock are required' }, 400)
  }

  try {
    const listingId = await createListing(c.env.DB, vendor.id, {
      product_id: Number(body.product_id),
      price_kobo: Number(body.price_kobo),
      compare_at_price_kobo: body.compare_at_price_kobo ? Number(body.compare_at_price_kobo) : null,
      stock: Number(body.stock),
      condition: body.condition,
      delivery_days_min: body.delivery_days_min ? Number(body.delivery_days_min) : undefined,
      delivery_days_max: body.delivery_days_max ? Number(body.delivery_days_max) : undefined,
      warranty_months: body.warranty_months ? Number(body.warranty_months) : undefined,
      unit_of_measure: body.unit_of_measure,
      unit_quantity: body.unit_quantity ? Number(body.unit_quantity) : undefined,
      is_variable_weight: !!body.is_variable_weight,
      variable_weight_tolerance_pct: body.variable_weight_tolerance_pct ? Number(body.variable_weight_tolerance_pct) : undefined,
      sku: body.sku ?? null,
      warehouse_location: body.warehouse_location ?? null,
      low_stock_threshold: body.low_stock_threshold ? Number(body.low_stock_threshold) : undefined,
      allow_backorder: !!body.allow_backorder,
    })

    if (Array.isArray(body.pricing_tiers) && body.pricing_tiers.length > 0) {
      await replacePricingTiers(
        c.env.DB,
        listingId,
        body.pricing_tiers.map((t: any) => ({
          min_quantity: Number(t.min_quantity),
          max_quantity: t.max_quantity !== undefined && t.max_quantity !== null ? Number(t.max_quantity) : null,
          unit_price_kobo: Number(t.unit_price_kobo),
          tier_label: t.tier_label ?? null,
        }))
      )
    }

    await recomputeBuyBoxWinner(c.env.DB, Number(body.product_id))

    return c.json({ id: listingId, moderation_status: 'pending_review' }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create listing' }, 400)
  }
})

sellerApi.patch('/listings/:id', async (c) => {
  const vendor = vendorOf(c)
  const listingId = Number(c.req.param('id'))
  const existing = await getOwnedListing(c.env.DB, vendor.id, listingId)
  if (!existing) return c.json({ error: 'Listing not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const input: Record<string, unknown> = {}
  for (const key of [
    'price_kobo',
    'compare_at_price_kobo',
    'condition',
    'delivery_days_min',
    'delivery_days_max',
    'warranty_months',
    'unit_of_measure',
    'unit_quantity',
    'variable_weight_tolerance_pct',
    'sku',
    'warehouse_location',
    'low_stock_threshold',
  ]) {
    if (body[key] !== undefined) input[key] = body[key]
  }
  for (const key of ['is_variable_weight', 'allow_backorder', 'is_active']) {
    if (body[key] !== undefined) input[key] = !!body[key]
  }
  // SECURITY FIX (Engine 2.1 hardening — critical gap found during
  // inspection): moderation_status is DELIBERATELY never accepted from the
  // seller here. The old code did
  // `if (body.moderation_status !== undefined) input.moderation_status = body.moderation_status`
  // with no role check, which let a seller PATCH their own listing to
  // moderation_status='active' and fully bypass admin review. Moderation
  // decisions now ONLY happen through applyModerationDecision
  // (src/lib/moderation.ts) behind requirePlatformRole('admin') — see
  // src/routes/api-admin.ts. If a client sends this field here it is
  // silently ignored (not an error), same as any other unsupported field.

  try {
    await updateListing(c.env.DB, vendor.id, listingId, input as any)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to update listing' }, 400)
  }

  if (Array.isArray(body.pricing_tiers)) {
    await replacePricingTiers(
      c.env.DB,
      listingId,
      body.pricing_tiers.map((t: any) => ({
        min_quantity: Number(t.min_quantity),
        max_quantity: t.max_quantity !== undefined && t.max_quantity !== null ? Number(t.max_quantity) : null,
        unit_price_kobo: Number(t.unit_price_kobo),
        tier_label: t.tier_label ?? null,
      }))
    )
  }

  await recomputeBuyBoxWinner(c.env.DB, existing.product_id)

  const updated = await getOwnedListing(c.env.DB, vendor.id, listingId)
  return c.json({ listing: updated })
})

sellerApi.get('/listings/:id/pricing-tiers', async (c) => {
  const vendor = vendorOf(c)
  const listingId = Number(c.req.param('id'))
  const listing = await getOwnedListing(c.env.DB, vendor.id, listingId)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const tiers = await getPricingTiersForListing(c.env.DB, listingId)
  return c.json({ tiers })
})

// ---------- Variants ----------

sellerApi.post('/listings/:id/variants', async (c) => {
  const vendor = vendorOf(c)
  const listingId = Number(c.req.param('id'))
  const listing = await getOwnedListing(c.env.DB, vendor.id, listingId)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  if (!body.variant_type || !body.variant_value) return c.json({ error: 'variant_type and variant_value are required' }, 400)

  const variantId = await createVariant(c.env.DB, listingId, {
    variant_type: String(body.variant_type),
    variant_value: String(body.variant_value),
    price_delta_kobo: body.price_delta_kobo ? Number(body.price_delta_kobo) : undefined,
    stock: body.stock ? Number(body.stock) : undefined,
  })
  return c.json({ id: variantId }, 201)
})

// ---------- Inventory ----------

sellerApi.get('/inventory', async (c) => {
  const vendor = vendorOf(c)
  const listings = await getListingsForVendor(c.env.DB, vendor.id, { limit: 200 })
  const withAvailability = (listings as any[]).map((l) => ({
    ...l,
    available_quantity: computeAvailableQuantity(l),
    is_low_stock: isLowStock(l),
  }))
  return c.json({ results: withAvailability })
})

sellerApi.get('/inventory/:listingId/history', async (c) => {
  const vendor = vendorOf(c)
  const listingId = Number(c.req.param('listingId'))
  const listing = await getOwnedListing(c.env.DB, vendor.id, listingId)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const history = await getInventoryHistory(c.env.DB, listingId)
  return c.json({ history })
})

sellerApi.post('/inventory/:listingId/adjust', async (c) => {
  const vendor = vendorOf(c)
  const listingId = Number(c.req.param('listingId'))
  const listing = await getOwnedListing(c.env.DB, vendor.id, listingId)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const delta = Number(body.delta)
  if (!Number.isFinite(delta) || delta === 0) return c.json({ error: 'delta must be a non-zero number' }, 400)

  const user = c.get('user')
  try {
    const newStock = await adjustStock(c.env.DB, listingId, delta, 'manual_adjustment', {
      actorUserId: user?.id,
      note: body.note ?? null,
    })
    return c.json({ stock: newStock })
  } catch (err: any) {
    if (err instanceof InsufficientStockError) return c.json({ error: err.message }, 409)
    return c.json({ error: err.message ?? 'Failed to adjust inventory' }, 400)
  }
})

// ---------- Orders ----------

sellerApi.get('/orders', async (c) => {
  const vendor = vendorOf(c)
  const results = await getOrdersForVendor(c.env.DB, vendor.id, {
    limit: Number(c.req.query('limit') ?? 50),
    offset: Number(c.req.query('offset') ?? 0),
  })
  return c.json({ results })
})

sellerApi.get('/orders/:orderId', async (c) => {
  const vendor = vendorOf(c)
  const orderId = Number(c.req.param('orderId'))
  // Deliberately returns ONLY this vendor's items for the order, never the
  // full multi-vendor order or other sellers' items within it.
  const items = await getVendorItemsForOrder(c.env.DB, vendor.id, orderId)
  if (items.length === 0) return c.json({ error: 'Order not found' }, 404)
  return c.json({ items })
})

/**
 * Marketplace Engine 2.1 (spec sections 3/4): replaces the previous ad-hoc
 * `updateOrderItemStatus` free-form action switch with the centralized
 * `transitionOrderItemStatus` state machine — legal transitions only,
 * ownership scoped by vendor_id, every change ledgered + event-logged.
 * `updateOrderItemStatus` itself is preserved unchanged in
 * seller-products.ts (not deleted — "preserve existing work"), but this
 * route no longer calls it, since it had no transition-legality
 * enforcement at all (any status could follow any status).
 */
sellerApi.patch('/orders/items/:orderItemId', async (c) => {
  const vendor = vendorOf(c)
  const user = c.get('user')!
  const orderItemId = Number(c.req.param('orderItemId'))
  const body = await c.req.json().catch(() => ({}))
  const targetStatus = body.status as OrderItemStatus
  const validTargets: OrderItemStatus[] = ['ready_for_fulfillment', 'shipped', 'delivered', 'completed', 'cancelled']
  if (!validTargets.includes(targetStatus)) {
    return c.json({ error: `status must be one of: ${validTargets.join(', ')}` }, 400)
  }
  try {
    const updated = await transitionOrderItemStatus(
      c.env.DB,
      orderItemId,
      targetStatus,
      { userId: user.id, role: 'seller', vendorId: vendor.id },
      {
        reason: body.reason,
        fulfilledQuantity: body.fulfilled_quantity !== undefined ? Number(body.fulfilled_quantity) : undefined,
      }
    )
    return c.json({ success: true, item: updated })
  } catch (err) {
    if (err instanceof NotOwnedOrderItemError) return c.json({ error: err.message }, 404)
    if (err instanceof IllegalTransitionError) return c.json({ error: err.message }, 400)
    if (err instanceof OrderLifecycleError) return c.json({ error: err.message }, 400)
    throw err
  }
})

/**
 * Variable-weight settlement (spec sections 12/13): after a seller has
 * fulfilled a variable-weight item with an actual quantity (via the PATCH
 * above), they call this to reconcile the final amount against what was
 * captured at checkout — issuing a refund (final lower) or creating a
 * pending additional charge for the customer to confirm (final higher).
 * Never auto-triggered from the PATCH above — kept as an explicit,
 * separate step so "record actual quantity" and "settle the financial
 * difference" are never silently conflated.
 */
sellerApi.post('/orders/items/:orderItemId/settle', async (c) => {
  const vendor = vendorOf(c)
  const user = c.get('user')!
  const orderItemId = Number(c.req.param('orderItemId'))
  const item = await c.env.DB.prepare('SELECT id FROM order_items WHERE id = ? AND vendor_id = ?').bind(orderItemId, vendor.id).first()
  if (!item) return c.json({ error: 'Order item not found' }, 404)
  try {
    const result = await settleVariableWeightItem(c.env.DB, orderItemId, user.id)
    return c.json({ success: true, ...result })
  } catch (err: any) {
    if (err instanceof SettlementError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// ---------- Disputes & refunds (seller-facing, spec section 6) ----------

sellerApi.get('/orders/:orderId/disputes', async (c) => {
  const vendor = vendorOf(c)
  const orderId = Number(c.req.param('orderId'))
  // Ownership check: this vendor must actually have an item on this order.
  const items = await getVendorItemsForOrder(c.env.DB, vendor.id, orderId)
  if (items.length === 0) return c.json({ error: 'Order not found' }, 404)
  const results = await getDisputesForOrder(c.env.DB, orderId)
  return c.json({ results })
})

sellerApi.get('/refunds', async (c) => {
  const vendor = vendorOf(c)
  const results = await getRefundsForVendor(c.env.DB, vendor.id, Number(c.req.query('limit') ?? 50))
  return c.json({ results })
})

sellerApi.get('/moderation/history', async (c) => {
  const vendor = vendorOf(c)
  const results = await getModerationHistoryForVendor(c.env.DB, vendor.id, Number(c.req.query('limit') ?? 50))
  return c.json({ results })
})

// ---------- Dynamic product attributes (spec sections 8/9) ----------

sellerApi.get('/products/:id/attributes', async (c) => {
  const vendor = vendorOf(c)
  const productId = Number(c.req.param('id'))
  const owned = await sellerOwnsProduct(c.env.DB, vendor.id, productId)
  if (!owned) return c.json({ error: 'Product not found' }, 404)
  const results = await getProductAttributeValues(c.env.DB, productId)
  return c.json({ results })
})

sellerApi.put('/products/:id/attributes', async (c) => {
  const vendor = vendorOf(c)
  const productId = Number(c.req.param('id'))
  const owned = await sellerOwnsProduct(c.env.DB, vendor.id, productId)
  if (!owned) return c.json({ error: 'Product not found' }, 404)

  const product = await getProductById(c.env.DB, productId)
  if (!product) return c.json({ error: 'Product not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  if (typeof body !== 'object' || body === null) return c.json({ error: 'A JSON object of { attribute_key: value } is required' }, 400)

  try {
    const resolved = await validateAndCollectAttributeValues(c.env.DB, product.category_id, body)
    await saveProductAttributeValues(c.env.DB, productId, resolved)
    const results = await getProductAttributeValues(c.env.DB, productId)
    return c.json({ success: true, results })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to save attributes' }, 400)
  }
})

// ---------- Country/location availability (spec section 11) ----------

sellerApi.get('/listings/:id/countries', async (c) => {
  const vendor = vendorOf(c)
  const listingId = Number(c.req.param('id'))
  const listing = await getOwnedListing(c.env.DB, vendor.id, listingId)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const results = await getListingCountryAvailability(c.env.DB, listingId)
  return c.json({ results })
})

sellerApi.put('/listings/:id/countries/:countryIso', async (c) => {
  const vendor = vendorOf(c)
  const listingId = Number(c.req.param('id'))
  const countryIso = c.req.param('countryIso').toUpperCase()
  const listing = await getOwnedListing(c.env.DB, vendor.id, listingId)
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  const body = await c.req.json<{ is_available: boolean }>().catch(() => ({ is_available: true }))
  await setListingCountryAvailability(c.env.DB, listingId, countryIso, !!body.is_available)
  return c.json({ success: true })
})
