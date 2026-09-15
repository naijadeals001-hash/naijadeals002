import { Hono } from 'hono'
import type { AppEnv, CategoryRow } from '../types'
import { getTopLevelCategories, getListingsForProduct, getVariantsForListing, getProductsByIds } from '../lib/catalog'
import { getHomepageFeed } from '../lib/homepage-feed'
import { getAllCollections, getCollectionBySlug, getProductsInCollection } from '../lib/collections'
import { getProductAttributeValues } from '../lib/attributes'
import { getLiveCountries } from '../lib/country'
import { getMegaMenuTree } from '../lib/mega-menu'

export const catalogApi = new Hono<AppEnv>()

/**
 * Marketplace Engine 2.1 (spec section 10): public-facing collections
 * feed — real DB-backed rows (collections/product_collections), never a
 * hardcoded frontend array. Powers "New Arrivals", "African Essentials",
 * etc landing sections.
 */
catalogApi.get('/collections', async (c) => {
  const results = await getAllCollections(c.env.DB, c.req.query('type'))
  return c.json({ results })
})

catalogApi.get('/collections/:slug', async (c) => {
  const collection = await getCollectionBySlug(c.env.DB, c.req.param('slug'))
  if (!collection) return c.json({ error: 'Collection not found' }, 404)
  const products = await getProductsInCollection(c.env.DB, c.req.param('slug'), Number(c.req.query('limit') ?? 24))
  return c.json({ collection, products })
})

/** Marketplace Engine 2.1 (spec section 11): LIVE markets only — the honest "ship to" selector data source. cc_countries is the existing, previously-dormant Control Center table (migration 0013), never a duplicated Country Engine. */
catalogApi.get('/countries', async (c) => {
  const results = await getLiveCountries(c.env.DB)
  return c.json({ results })
})

/** All PRODUCT-taxonomy categories (any depth) — the mega-menu / catalog-browsing data source. Scoped to category_type='product' so NaijaGigs' service categories never leak into a marketplace listing (Phase 1a bug fix). */
catalogApi.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM categories WHERE category_type = 'product' ORDER BY level ASC, sort_order ASC`).all<CategoryRow>()
  return c.json(results)
})

catalogApi.get('/categories/top', async (c) => {
  const results = await getTopLevelCategories(c.env.DB)
  return c.json(results)
})

/**
 * Nested Department -> Group -> Subcategory -> Leaf tree (any depth, African/
 * country-specific nodes in-line) — the DB-driven "All Categories" mega-menu's
 * sole data source (Phase 1b). See src/lib/mega-menu.ts.
 */
catalogApi.get('/categories/tree', async (c) => {
  const results = await getMegaMenuTree(c.env.DB)
  return c.json(results)
})

catalogApi.get('/homepage-feed', async (c) => {
  const feed = await getHomepageFeed(c.env.DB)
  return c.json(feed)
})

/** Hydrates "Recently Viewed" from the visitor's own localStorage id list (client-side history, no server-side tracking). */
catalogApi.get('/products/by-ids', async (c) => {
  const idsParam = c.req.query('ids') || ''
  const ids = idsParam
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 20)
  if (ids.length === 0) return c.json({ products: [] })
  const products = await getProductsByIds(c.env.DB, ids)
  return c.json({ products })
})

/** Search/listing endpoint used by /shop search results page. Joined to each product's primary listing. */
catalogApi.get('/products', async (c) => {
  const category = c.req.query('category')
  const q = c.req.query('q')
  const deals = c.req.query('deals')
  const sort = c.req.query('sort') || 'newest'
  const minPrice = c.req.query('min_price')
  const maxPrice = c.req.query('max_price')
  const minRating = c.req.query('min_rating')
  const brand = c.req.query('brand')
  const nigerianOnly = c.req.query('nigerian')
  const page = Math.max(1, Number(c.req.query('page') || '1'))
  const perPage = 24
  const offset = (page - 1) * perPage

  let sql = `
    SELECT p.*, cat.name as category_name, cat.slug as category_slug,
           b.name as brand_name, b.slug as brand_slug,
           l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
           l.price_kobo, l.compare_at_price_kobo, l.stock,
           l.delivery_days_min, l.delivery_days_max, l.is_plus,
           (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count
    FROM products p
    JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
    JOIN vendors v ON v.id = l.vendor_id
    JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.is_active = 1
  `
  const binds: any[] = []

  if (category) {
    // Match the category or any descendant at any depth via the materialized path
    // (migration 0053) — a "Fashion" filter must also surface "Ankara Fabric" products,
    // not just its direct children.
    const categoryRoot = await c.env.DB.prepare('SELECT id, path FROM categories WHERE slug = ?').bind(category).first<{ id: number; path: string | null }>()
    if (categoryRoot) {
      sql += ' AND (cat.id = ? OR cat.path LIKE ?)'
      binds.push(categoryRoot.id, `${categoryRoot.path ?? categoryRoot.id}/%`)
    } else {
      sql += ' AND 1 = 0'
    }
  }
  if (q) {
    sql += ' AND (p.title LIKE ? OR p.description LIKE ? OR v.name LIKE ?)'
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  if (deals === '1') {
    sql += ' AND l.compare_at_price_kobo IS NOT NULL'
  }
  if (minPrice) {
    sql += ' AND l.price_kobo >= ?'
    binds.push(Number(minPrice) * 100)
  }
  if (maxPrice) {
    sql += ' AND l.price_kobo <= ?'
    binds.push(Number(maxPrice) * 100)
  }
  if (minRating) {
    sql += ' AND p.rating_avg >= ?'
    binds.push(Number(minRating))
  }
  if (brand) {
    sql += ' AND b.slug = ?'
    binds.push(brand)
  }
  if (nigerianOnly === '1') {
    sql += ' AND b.is_nigerian = 1'
  }

  // count query (same WHERE, no pagination) for pagination UI
  const countSql = sql.replace(
    /SELECT p\.\*.*FROM products p/s,
    'SELECT COUNT(*) as total FROM products p'
  )
  const countRow = await c.env.DB.prepare(countSql).bind(...binds).first<{ total: number }>()

  switch (sort) {
    case 'price_asc':
      sql += ' ORDER BY l.price_kobo ASC'
      break
    case 'price_desc':
      sql += ' ORDER BY l.price_kobo DESC'
      break
    case 'rating':
      sql += ' ORDER BY p.rating_avg DESC'
      break
    case 'bestselling':
      sql += ' ORDER BY p.sales_count DESC'
      break
    default:
      sql += ' ORDER BY p.id DESC'
  }
  sql += ' LIMIT ? OFFSET ?'
  binds.push(perPage, offset)

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ products: results, total: countRow?.total ?? 0, page, per_page: perPage })
})

catalogApi.get('/products/:slug', async (c) => {
  const slug = c.req.param('slug')
  const product = await c.env.DB.prepare(
    `SELECT p.*, cat.name as category_name, cat.slug as category_slug, b.name as brand_name, b.slug as brand_slug
     FROM products p
     JOIN categories cat ON cat.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.slug = ? AND p.is_active = 1`
  ).bind(slug).first<any>()

  if (!product) return c.json({ error: 'Product not found' }, 404)

  const listings = await getListingsForProduct(c.env.DB, product.id)
  const primaryListing: any = (listings.results as any[]).find((l) => l.is_primary === 1) ?? listings.results[0]
  const variants = primaryListing ? await getVariantsForListing(c.env.DB, primaryListing.id) : { results: [] }

  const reviews = await c.env.DB.prepare(
    'SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(product.id).all()

  const questions = await c.env.DB.prepare(
    'SELECT * FROM product_questions WHERE product_id = ? ORDER BY created_at DESC LIMIT 10'
  ).bind(product.id).all()

  const related = await c.env.DB.prepare(
    `SELECT p.*, l.price_kobo, l.compare_at_price_kobo, l.stock, l.delivery_days_min, l.delivery_days_max, l.is_plus, l.id as listing_id, l.vendor_id,
            v.name as vendor_name, v.slug as vendor_slug,
            (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active=1) as seller_count
     FROM products p
     JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
     JOIN vendors v ON v.id = l.vendor_id
     WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1 LIMIT 8`
  ).bind(product.category_id, product.id).all()

  // Marketplace Engine 2.1 (spec section 19): structured, category-driven
  // attribute values for this product — never a hardcoded field list.
  // Only ever exposes already-validated, seller-saved values (attributes.ts's
  // validateAndCollectAttributeValues gate happened at write time), so no
  // internal moderation metadata leaks here.
  const attributes = await getProductAttributeValues(c.env.DB, product.id)

  return c.json({
    product,
    listings: listings.results,
    variants: variants.results,
    reviews: reviews.results,
    questions: questions.results,
    related: related.results,
    attributes
  })
})

catalogApi.post('/newsletter', async (c) => {
  const body = await c.req.json<{ email: string }>().catch(() => null)
  if (!body?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ error: 'Valid email required' }, 400)
  }
  await c.env.DB.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email) VALUES (?)').bind(body.email).run()
  return c.json({ success: true })
})
