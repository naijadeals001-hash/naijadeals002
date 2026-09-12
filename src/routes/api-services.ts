/**
 * Public Service Discovery API — Service Engine 2.0 (spec section 22, 23, 45).
 * No authentication required — mirrors src/routes/api-catalog.ts's public
 * discovery pattern for the Marketplace Engine.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import {
  getTopLevelServiceCategories,
  getServiceSubcategories,
  getPublicServiceListings,
  getPublicServiceListingById,
  getPackagesForListing,
  getAreasForProvider
} from '../lib/services'

export const servicesApi = new Hono<AppEnv>()

// GET /api/service-categories — spec section 45
servicesApi.get('/service-categories', async (c) => {
  const parent = c.req.query('parent')
  if (parent) {
    const subs = await getServiceSubcategories(c.env.DB, parent)
    return c.json(subs)
  }
  const top = await getTopLevelServiceCategories(c.env.DB)
  return c.json(top)
})

// GET /api/services — spec section 45
servicesApi.get('/services', async (c) => {
  const category = c.req.query('category') ?? undefined
  const city = c.req.query('city') ?? undefined
  const country = c.req.query('country') ?? undefined
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
  const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined

  const listings = await getPublicServiceListings(c.env.DB, { categorySlug: category, city, countryIso: country, limit, offset })
  return c.json(listings)
})

// GET /api/services/:id — spec section 45
servicesApi.get('/services/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const listing = await getPublicServiceListingById(c.env.DB, id)
  if (!listing) return c.json({ error: 'Service not found' }, 404)

  const packages = await getPackagesForListing(c.env.DB, id)
  return c.json({ listing, packages })
})

// GET /api/providers — spec section 45 (public provider list, verified/active only)
servicesApi.get('/providers', async (c) => {
  const category = c.req.query('category')
  const country = c.req.query('country') ?? 'NG'
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 20

  const clauses = [`pp.operational_status = 'active'`, `pp.country_iso = ?`]
  const binds: unknown[] = [country]
  if (category) {
    clauses.push(`pp.primary_category_id = (SELECT id FROM categories WHERE slug = ?)`)
    binds.push(category)
  }
  binds.push(limit)

  const { results } = await c.env.DB
    .prepare(
      `SELECT pp.id, pp.display_name, pp.bio, pp.avatar_url, pp.rating_avg, pp.rating_count, pp.verification_status, pp.country_iso,
              cat.name AS primary_category_name, cat.slug AS primary_category_slug
       FROM provider_profiles pp
       LEFT JOIN categories cat ON cat.id = pp.primary_category_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY pp.verification_status = 'verified' DESC, pp.rating_avg DESC, pp.rating_count DESC
       LIMIT ?`
    )
    .bind(...binds)
    .all()
  return c.json(results)
})

// GET /api/providers/:id — spec section 45 (public provider profile)
servicesApi.get('/providers/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const provider = await c.env.DB
    .prepare(
      `SELECT pp.id, pp.display_name, pp.bio, pp.avatar_url, pp.rating_avg, pp.rating_count, pp.verification_status,
              pp.country_iso, cat.name AS primary_category_name, cat.slug AS primary_category_slug
       FROM provider_profiles pp
       LEFT JOIN categories cat ON cat.id = pp.primary_category_id
       WHERE pp.id = ? AND pp.operational_status = 'active'`
    )
    .bind(id)
    .first()
  if (!provider) return c.json({ error: 'Provider not found' }, 404)

  const listings = await getPublicServiceListings(c.env.DB, { limit: 50 })
  const providerListings = listings.filter((l: any) => l.provider_display_name === (provider as any).display_name)
  const areas = await getAreasForProvider(c.env.DB, id)

  // Reuse the shared Reviews Engine (reviews.reviewable_type already
  // supports 'provider_profile' since migration 0027) — no isolated
  // review architecture for services (spec section 20).
  const { results: reviews } = await c.env.DB
    .prepare(
      `SELECT r.id, r.rating, r.title, r.comment, r.created_at, r.author_name
       FROM reviews r
       WHERE r.reviewable_type = 'provider_profile' AND r.reviewable_id = ? AND r.status = 'published'
       ORDER BY r.created_at DESC LIMIT 20`
    )
    .bind(id)
    .all()
    .catch(() => ({ results: [] as any[] }))

  return c.json({ provider, listings: providerListings, areas, reviews })
})
