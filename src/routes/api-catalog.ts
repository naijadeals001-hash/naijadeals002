import { Hono } from 'hono'
import type { AppEnv, CategoryRow } from '../types'
import { getTopLevelCategories, getListingsForProduct, getVariantsForListing, getProductsByIds } from '../lib/catalog'
import { getHomepageFeed } from '../lib/homepage-feed'

export const catalogApi = new Hono<AppEnv>()

catalogApi.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all<CategoryRow>()
  return c.json(results)
})

catalogApi.get('/categories/top', async (c) => {
  const results = await getTopLevelCategories(c.env.DB)
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
    sql += ' AND (cat.slug = ? OR cat.parent_id = (SELECT id FROM categories WHERE slug = ?))'
    binds.push(category, category)
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

  return c.json({
    product,
    listings: listings.results,
    variants: variants.results,
    reviews: reviews.results,
    questions: questions.results,
    related: related.results
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
