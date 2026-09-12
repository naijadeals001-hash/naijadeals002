/**
 * Marketplace Engine 2.1 — Admin & Operations API (spec sections 16/10/6).
 *
 * Every route here is gated by `requirePlatformRole('admin')`
 * (src/lib/rbac.ts) — the FIRST real caller of that function, which has
 * existed since migration 0037 with zero callers until this pass
 * (confirmed via grep during inspection). This is the Marketplace-facing
 * slice of the Admin & Operations Command Center — it operates on the
 * SAME authoritative tables customers/sellers use (product_listings,
 * orders, collections, disputes), never a parallel admin_* copy, per the
 * Master Ecosystem Directive section 11's explicit prohibition.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { requirePlatformRole } from '../lib/rbac'
import { getPendingModerationQueue, getListingForModeration, applyModerationDecision } from '../lib/moderation'
import {
  createCollection,
  updateCollection,
  setCollectionActive,
  getAllCollectionsForAdmin,
  addProductToCollectionOrdered,
  removeProductFromCollectionById,
  reorderCollectionProducts,
  getCollectionProductsForAdmin,
} from '../lib/collections-admin'
import { getOpenDisputesForAdmin, resolveDispute, createAndExecuteRefund, RefundError } from '../lib/refunds'
import { createCategoryAttribute, updateCategoryAttribute, deleteCategoryAttribute, getAttributesForCategory } from '../lib/attributes'
import { getAllCountries } from '../lib/country'

export const adminApi = new Hono<AppEnv>()

adminApi.use('*', requireAuth)
adminApi.use('*', requirePlatformRole('admin'))

// ---------- Product moderation (spec section 16) ----------

adminApi.get('/moderation/queue', async (c) => {
  const results = await getPendingModerationQueue(c.env.DB, Number(c.req.query('limit') ?? 100))
  return c.json({ results })
})

adminApi.get('/moderation/listings/:id', async (c) => {
  const listing = await getListingForModeration(c.env.DB, Number(c.req.param('id')))
  if (!listing) return c.json({ error: 'Listing not found' }, 404)
  return c.json({ listing })
})

adminApi.post('/moderation/listings/:id/decision', async (c) => {
  const user = c.get('user')!
  const listingId = Number(c.req.param('id'))
  const body = await c.req.json<{ decision: string; reason?: string }>().catch(() => null)
  if (!body || !['approve', 'reject', 'suspend', 'request_changes'].includes(body.decision)) {
    return c.json({ error: 'decision must be one of: approve, reject, suspend, request_changes' }, 400)
  }
  try {
    const result = await applyModerationDecision(c.env.DB, listingId, body.decision as any, user.id, user.name, body.reason)
    return c.json({ success: true, ...result })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to apply moderation decision' }, 400)
  }
})

// ---------- Collections (spec section 10) ----------

adminApi.get('/collections', async (c) => {
  const results = await getAllCollectionsForAdmin(c.env.DB)
  return c.json({ results })
})

adminApi.post('/collections', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  if (!body.slug || !body.name) return c.json({ error: 'slug and name are required' }, 400)
  try {
    const id = await createCollection(c.env.DB, user.id, body)
    return c.json({ id }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create collection' }, 400)
  }
})

adminApi.patch('/collections/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const ok = await updateCollection(c.env.DB, id, body)
  if (!ok) return c.json({ error: 'Collection not found' }, 404)
  return c.json({ success: true })
})

adminApi.post('/collections/:id/activate', async (c) => {
  const ok = await setCollectionActive(c.env.DB, Number(c.req.param('id')), true)
  if (!ok) return c.json({ error: 'Collection not found' }, 404)
  return c.json({ success: true })
})

adminApi.post('/collections/:id/deactivate', async (c) => {
  const ok = await setCollectionActive(c.env.DB, Number(c.req.param('id')), false)
  if (!ok) return c.json({ error: 'Collection not found' }, 404)
  return c.json({ success: true })
})

adminApi.get('/collections/:id/products', async (c) => {
  const results = await getCollectionProductsForAdmin(c.env.DB, Number(c.req.param('id')))
  return c.json({ results })
})

adminApi.post('/collections/:id/products', async (c) => {
  const collectionId = Number(c.req.param('id'))
  const body = await c.req.json<{ product_id: number; sort_order?: number }>().catch(() => null)
  if (!body?.product_id) return c.json({ error: 'product_id required' }, 400)
  try {
    await addProductToCollectionOrdered(c.env.DB, collectionId, body.product_id, body.sort_order)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to add product' }, 400)
  }
})

adminApi.delete('/collections/:id/products/:productId', async (c) => {
  const ok = await removeProductFromCollectionById(c.env.DB, Number(c.req.param('id')), Number(c.req.param('productId')))
  if (!ok) return c.json({ error: 'Product not in this collection' }, 404)
  return c.json({ success: true })
})

adminApi.post('/collections/:id/reorder', async (c) => {
  const body = await c.req.json<{ product_ids: number[] }>().catch(() => null)
  if (!Array.isArray(body?.product_ids)) return c.json({ error: 'product_ids array required' }, 400)
  await reorderCollectionProducts(c.env.DB, Number(c.req.param('id')), body.product_ids)
  return c.json({ success: true })
})

// ---------- Category attribute definitions (spec section 9) ----------

adminApi.get('/categories/:categoryId/attributes', async (c) => {
  const results = await getAttributesForCategory(c.env.DB, Number(c.req.param('categoryId')))
  return c.json({ results })
})

adminApi.post('/categories/:categoryId/attributes', async (c) => {
  const categoryId = Number(c.req.param('categoryId'))
  const body = await c.req.json().catch(() => ({}))
  if (!body.key || !body.label || !body.data_type) return c.json({ error: 'key, label and data_type are required' }, 400)
  try {
    const id = await createCategoryAttribute(c.env.DB, { ...body, category_id: categoryId })
    return c.json({ id }, 201)
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to create attribute' }, 400)
  }
})

adminApi.patch('/attributes/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const ok = await updateCategoryAttribute(c.env.DB, Number(c.req.param('id')), body)
    if (!ok) return c.json({ error: 'Attribute not found' }, 404)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message ?? 'Failed to update attribute' }, 400)
  }
})

adminApi.delete('/attributes/:id', async (c) => {
  const ok = await deleteCategoryAttribute(c.env.DB, Number(c.req.param('id')))
  if (!ok) return c.json({ error: 'Attribute not found' }, 404)
  return c.json({ success: true })
})

// ---------- Disputes & refunds (spec section 6) ----------

adminApi.get('/disputes', async (c) => {
  const results = await getOpenDisputesForAdmin(c.env.DB, Number(c.req.query('limit') ?? 100))
  return c.json({ results })
})

adminApi.post('/disputes/:id/resolve', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ status: 'resolved' | 'rejected'; note: string }>().catch(() => null)
  if (!body?.status || !body?.note) return c.json({ error: 'status and note are required' }, 400)
  const ok = await resolveDispute(c.env.DB, Number(c.req.param('id')), user.id, body.status, body.note)
  if (!ok) return c.json({ error: 'Dispute not found or already resolved' }, 404)
  return c.json({ success: true })
})

adminApi.post('/orders/:orderId/refund', async (c) => {
  const user = c.get('user')!
  const orderId = Number(c.req.param('orderId'))
  const body = await c.req.json<{ order_item_id?: number; amount_kobo: number; reason: string; refund_type?: string }>().catch(() => null)
  if (!body?.amount_kobo || !body?.reason) return c.json({ error: 'amount_kobo and reason are required' }, 400)
  try {
    const result = await createAndExecuteRefund(c.env.DB, {
      orderId,
      orderItemId: body.order_item_id ?? null,
      amountKobo: Number(body.amount_kobo),
      reason: body.reason,
      refundType: (body.refund_type as any) ?? 'partial',
      initiatedByUserId: user.id,
      initiatedByRole: 'admin',
    })
    return c.json({ success: true, ...result })
  } catch (err: any) {
    if (err instanceof RefundError) return c.json({ error: err.message }, 400)
    throw err
  }
})

// ---------- Country reference data (spec section 11) ----------

adminApi.get('/countries', async (c) => {
  const results = await getAllCountries(c.env.DB)
  return c.json({ results })
})
