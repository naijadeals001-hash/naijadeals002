/**
 * Payment Engine — Unit 4 (Engine 7 Phase 2): order/listing fixture helpers.
 *
 * createPendingOrder()/payOrderFromWallet()/confirmOrderPayment() all need a
 * real product_listings row with enough stock to survive a many-way
 * concurrent test without ever going negative or running out — reusing the
 * project's shared seed data listings would risk cross-test interference
 * (another suite/run decrementing the same row's stock at the same time)
 * and would leave test-induced stock drift on rows outside this harness's
 * ownership. Instead, each fixture call creates its OWN fresh product +
 * listing row (category_id/vendor_id borrowed from the existing seed data,
 * which is read-only here), with a large stock buffer, so every test's
 * concurrency assertions are provably isolated to data it alone owns.
 */
import { getTestDb } from './db.mjs'

let cachedCategoryId = null
let cachedVendorId = null

async function getAnyCategoryId(db) {
  if (cachedCategoryId) return cachedCategoryId
  const row = await db.prepare('SELECT id FROM categories LIMIT 1').first()
  cachedCategoryId = row.id
  return cachedCategoryId
}

async function getAnyVendorId(db) {
  if (cachedVendorId) return cachedVendorId
  const row = await db.prepare('SELECT id FROM vendors LIMIT 1').first()
  cachedVendorId = row.id
  return cachedVendorId
}

/**
 * Creates a fresh product + product_listings row with the given price/stock
 * and returns a fully-shaped CartItemRow-compatible object, ready to pass
 * straight into createPendingOrder()'s `items` array.
 */
export async function createTestCartItem({ label, priceKobo = 500000, stock = 100000, quantity = 1 }) {
  const db = await getTestDb()
  const categoryId = await getAnyCategoryId(db)
  const vendorId = await getAnyVendorId(db)
  const nonce = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`

  const productInsert = await db
    .prepare(
      `INSERT INTO products (slug, category_id, title, image_url) VALUES (?, ?, ?, ?)`
    )
    .bind(`payment-test-${label}-${nonce}`, categoryId, `Payment Test Product ${label}`, '/static/ph.svg')
    .run()
  const productId = Number(productInsert.meta.last_row_id)

  const listingInsert = await db
    .prepare(
      `INSERT INTO product_listings (product_id, vendor_id, price_kobo, stock) VALUES (?, ?, ?, ?)`
    )
    .bind(productId, vendorId, priceKobo, stock)
    .run()
  const listingId = Number(listingInsert.meta.last_row_id)

  return {
    id: 0,
    cart_id: 0,
    listing_id: listingId,
    variant_id: null,
    quantity,
    is_saved_for_later: 0,
    product_id: productId,
    title: `Payment Test Product ${label}`,
    slug: `payment-test-${label}-${nonce}`,
    image_url: '/static/ph.svg',
    price_kobo: priceKobo,
    compare_at_price_kobo: null,
    stock,
    vendor_id: vendorId,
    vendor_name: 'Test Vendor',
    vendor_slug: 'test-vendor',
    is_verified: 1,
    delivery_days_min: 1,
    delivery_days_max: 3,
    variant_value: null
  }
}
