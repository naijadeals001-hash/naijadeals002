import { Hono } from 'hono'
import type { AppEnv, ProductRow, CategoryRow } from '../types'

export const catalogApi = new Hono<AppEnv>()

catalogApi.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all<CategoryRow>()
  return c.json(results)
})

catalogApi.get('/products', async (c) => {
  const category = c.req.query('category')
  const q = c.req.query('q')
  const deals = c.req.query('deals')
  const sort = c.req.query('sort') || 'newest'

  let sql = `
    SELECT p.*, v.name as vendor_name, v.slug as vendor_slug, cat.name as category_name, cat.slug as category_slug
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    JOIN categories cat ON cat.id = p.category_id
    WHERE p.is_active = 1
  `
  const binds: any[] = []

  if (category) {
    sql += ' AND cat.slug = ?'
    binds.push(category)
  }
  if (q) {
    sql += ' AND (p.title LIKE ? OR p.description LIKE ?)'
    binds.push(`%${q}%`, `%${q}%`)
  }
  if (deals === '1') {
    sql += ' AND p.compare_at_price_kobo IS NOT NULL'
  }

  switch (sort) {
    case 'price_asc':
      sql += ' ORDER BY p.price_kobo ASC'
      break
    case 'price_desc':
      sql += ' ORDER BY p.price_kobo DESC'
      break
    case 'rating':
      sql += ' ORDER BY p.rating_avg DESC'
      break
    default:
      sql += ' ORDER BY p.id DESC'
  }

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<ProductRow>()
  return c.json(results)
})

catalogApi.get('/products/flash-deals', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, v.name as vendor_name, v.slug as vendor_slug
     FROM products p JOIN vendors v ON v.id = p.vendor_id
     WHERE p.is_flash_deal = 1 AND p.is_active = 1 ORDER BY p.id ASC LIMIT 6`
  ).all<ProductRow>()
  return c.json(results)
})

catalogApi.get('/products/recommended', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, v.name as vendor_name, v.slug as vendor_slug
     FROM products p JOIN vendors v ON v.id = p.vendor_id
     WHERE p.is_active = 1 ORDER BY p.rating_count DESC LIMIT 10`
  ).all<ProductRow>()
  return c.json(results)
})

catalogApi.get('/products/:slug', async (c) => {
  const slug = c.req.param('slug')
  const product = await c.env.DB.prepare(
    `SELECT p.*, v.name as vendor_name, v.slug as vendor_slug, cat.name as category_name, cat.slug as category_slug
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id
     JOIN categories cat ON cat.id = p.category_id
     WHERE p.slug = ? AND p.is_active = 1`
  ).bind(slug).first<ProductRow>()

  if (!product) return c.json({ error: 'Product not found' }, 404)

  const reviews = await c.env.DB.prepare(
    'SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(product.id).all()

  const related = await c.env.DB.prepare(
    `SELECT p.*, v.name as vendor_name FROM products p JOIN vendors v ON v.id = p.vendor_id
     WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1 LIMIT 6`
  ).bind(product.category_id, product.id).all<ProductRow>()

  return c.json({ product, reviews: reviews.results, related: related.results })
})

catalogApi.post('/newsletter', async (c) => {
  const body = await c.req.json<{ email: string }>().catch(() => null)
  if (!body?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ error: 'Valid email required' }, 400)
  }
  await c.env.DB.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email) VALUES (?)').bind(body.email).run()
  return c.json({ success: true })
})
