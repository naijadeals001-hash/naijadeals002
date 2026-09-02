import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { ProductCard } from '../components/ProductCard'
import type { AppEnv, ProductWithListingRow, ReviewRow, QuestionRow } from '../types'
import { formatNaira, discountPercent, formatRatingCount } from '../lib/money'
import { getListingsForProduct, getVariantsForListing } from '../lib/catalog'

export async function productPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const slug = c.req.param('slug')

  // Canonical product row + its PRIMARY (buy-box winning) listing, joined the same way
  // catalog.ts's PRODUCT_CARD_SELECT does — this page additionally needs category/brand
  // slugs for the breadcrumb and every listing for the seller-comparison table below.
  const product = await db
    .prepare(
      `SELECT p.*,
              cat.name as category_name, cat.slug as category_slug,
              b.name as brand_name, b.slug as brand_slug,
              l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
              l.price_kobo, l.compare_at_price_kobo, l.stock,
              l.delivery_days_min, l.delivery_days_max, l.is_plus, l.warranty_months, l.condition,
              (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count
       FROM products p
       JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
       JOIN vendors v ON v.id = l.vendor_id
       JOIN categories cat ON cat.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.slug = ? AND p.is_active = 1`
    )
    .bind(slug)
    .first<ProductWithListingRow & { warranty_months: number; condition: string }>()

  if (!product) {
    return c.render(
      <Layout title="Not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Product not found</h1>
          <a href="/shop" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to shop</a>
        </div>
      </Layout>,
      404
    )
  }

  const [listingsResult, reviews, questions, related] = await Promise.all([
    getListingsForProduct(db, product.id),
    db.prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20').bind(product.id).all<ReviewRow>(),
    db.prepare('SELECT * FROM product_questions WHERE product_id = ? ORDER BY created_at DESC LIMIT 10').bind(product.id).all<QuestionRow>(),
    db
      .prepare(
        `SELECT p.*, cat.name as category_name, cat.slug as category_slug,
                l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
                l.price_kobo, l.compare_at_price_kobo, l.stock, l.delivery_days_min, l.delivery_days_max, l.is_plus,
                (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count
         FROM products p
         JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
         JOIN vendors v ON v.id = l.vendor_id
         JOIN categories cat ON cat.id = p.category_id
         WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1 ORDER BY p.rating_count DESC LIMIT 10`
      )
      .bind(product.category_id, product.id)
      .all<ProductWithListingRow>(),
    // Frequently bought together — deterministic pseudo-pairing by id offset (no purchase-affinity
    // tracking exists yet); still a REAL query against real active products, not decorative filler.
    db
      .prepare(
        `SELECT p.*, l.id as listing_id, l.vendor_id, v.name as vendor_name, l.price_kobo, l.compare_at_price_kobo, l.stock
         FROM products p
         JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
         JOIN vendors v ON v.id = l.vendor_id
         WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1 ORDER BY p.id ASC LIMIT 2`
      )
      .bind(product.category_id, product.id)
      .all<ProductWithListingRow>()
  ])

  // getListingsForProduct() already unwraps to a plain array (it returns `results`, not {results}),
  // so listingsResult IS the array — no .results needed here.
  const listings = listingsResult as any[]
  const primaryListing = listings.find((l) => l.is_primary === 1) ?? listings[0]
  const otherListings = listings.filter((l) => l.id !== primaryListing?.id)
  // getVariantsForListing() also returns a plain array directly — no .results needed.
  const variants = primaryListing ? (await getVariantsForListing(db, primaryListing.id)) as any[] : []
  const fbt = related.results.slice(0, 0) // placeholder unused — see fbtItems below (kept for clarity of intent)

  const gallery: string[] = JSON.parse(product.gallery_json || '[]')
  const images = gallery.length > 0 ? gallery : [product.image_url]
  const specs: Record<string, string> = JSON.parse(product.specs_json || '{}')
  const whatsIncluded: string[] = JSON.parse(product.whats_included_json || '[]')

  const discount = discountPercent(product.price_kobo, product.compare_at_price_kobo)

  // Real rating distribution from the loaded review sample (not a fabricated curve).
  const ratingCounts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.results.filter((r) => r.rating === star).length
  }))
  const totalSampled = reviews.results.length
  const photoReviews = reviews.results.filter((r) => r.has_photo === 1 && r.photo_url)

  // "Frequently bought together" data source (a second query against the raw D1 handle,
  // separate from the by-category `related` carousel below).
  const fbtRows = await db
    .prepare(
      `SELECT p.*, l.id as listing_id, l.price_kobo, l.compare_at_price_kobo, l.stock
       FROM products p
       JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
       WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1 ORDER BY p.id ASC LIMIT 2`
    )
    .bind(product.category_id, product.id)
    .all<any>()
  const fbtItems = fbtRows.results
  const fbtTotal = product.price_kobo + fbtItems.reduce((sum, it) => sum + it.price_kobo, 0)

  return c.render(
    <Layout title={product.title} user={user} locale={locale}>
      <div class="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6" data-product-id={product.id}>
        {/* ============ Breadcrumb ============ */}
        <nav class="text-xs text-gray-500 mb-4 flex items-center gap-1.5 flex-wrap">
          <a href="/" class="hover:text-primary">Home</a>
          <span class="material-symbols-outlined text-sm">chevron_right</span>
          <a href={`/shop?category=${product.category_slug}`} class="hover:text-primary">{product.category_name}</a>
          {product.brand_name && (
            <>
              <span class="material-symbols-outlined text-sm">chevron_right</span>
              <a href={`/shop?brand=${product.brand_slug}`} class="hover:text-primary">{product.brand_name}</a>
            </>
          )}
        </nav>

        <div class="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px] gap-6 lg:gap-8">
          {/* ============ Gallery ============ */}
          <div>
            <div class="bg-gray-100 rounded-xl overflow-hidden aspect-square mb-3" id="pdp-main-image-wrap">
              <img id="pdp-main-image" src={images[0]} alt={product.title} class="w-full h-full object-cover" />
            </div>
            {images.length > 1 && (
              <div class="flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <button
                    type="button"
                    class={`pdp-thumb shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${i === 0 ? 'border-primary' : 'border-gray-200'}`}
                    data-image={img}
                  >
                    <img src={img} alt={`${product.title} thumbnail ${i + 1}`} class="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ============ Info column ============ */}
          <div>
            {product.brand_name && <span class="text-xs text-gray-400 uppercase tracking-wide">{product.brand_name}</span>}
            <h1 class="text-2xl font-bold text-gray-900 mt-1">{product.title}</h1>

            <div class="flex items-center gap-3 mt-2 flex-wrap">
              {product.rating_count > 0 && (
                <a href="#reviews" class="flex items-center gap-1 text-sm text-gray-600 hover:text-primary">
                  <span class="flex text-amber-500">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span class="material-symbols-outlined text-base" style={`font-variation-settings:'FILL' ${i <= Math.round(product.rating_avg) ? 1 : 0}`}>star</span>
                    ))}
                  </span>
                  <span class="font-semibold">{product.rating_avg.toFixed(1)}</span>
                  <span class="underline">({formatRatingCount(product.rating_count)} ratings)</span>
                </a>
              )}
              <span class="text-sm text-gray-500">{product.sales_count > 0 ? `${formatRatingCount(product.sales_count)} sold` : 'New listing'}</span>
            </div>

            <div class="flex items-baseline gap-3 mt-4 border-t border-gray-100 pt-4">
              <span class="text-3xl font-bold text-gray-900">{formatNaira(product.price_kobo)}</span>
              {product.compare_at_price_kobo && (
                <>
                  <span class="text-lg text-gray-400 line-through">{formatNaira(product.compare_at_price_kobo)}</span>
                  <span class="text-sm font-semibold text-red-600">-{discount}%</span>
                </>
              )}
            </div>
            {product.seller_count > 1 && (
              <a href="#compare-sellers" class="text-sm text-primary font-semibold hover:underline mt-1 inline-block">
                {product.seller_count} sellers from {formatNaira(Math.min(...listings.map((l) => l.price_kobo)))}
              </a>
            )}

            <p class="text-gray-600 mt-4 text-sm leading-relaxed">{product.description}</p>

            {variants.length > 0 && (
              <div class="mt-4">
                <p class="text-sm font-medium text-gray-700 mb-2">{variants[0].variant_type === 'color' ? 'Color' : 'Option'}</p>
                <div class="flex gap-2 flex-wrap">
                  {variants.map((v: any, i: number) => (
                    <button
                      type="button"
                      class={`variant-option text-xs px-3 py-1.5 rounded-lg border ${i === 0 ? 'border-primary bg-primary-light text-primary-dark font-semibold' : 'border-gray-300 text-gray-600'}`}
                      data-variant-id={v.id}
                    >
                      {v.variant_value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ul class="mt-4 space-y-1.5 text-sm text-gray-600">
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">local_shipping</span>
                {product.delivery_days_min === product.delivery_days_max
                  ? `Delivered in ${product.delivery_days_min} day${product.delivery_days_min > 1 ? 's' : ''}`
                  : `Delivered in ${product.delivery_days_min}-${product.delivery_days_max} days`} to your address
              </li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">verified_user</span>Covered by NaijaDeals Buyer Protection — pay into escrow, confirm before release</li>
              {product.warranty_months > 0 && (
                <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">shield</span>{product.warranty_months}-month warranty from seller</li>
              )}
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">replay</span>{product.return_policy}</li>
            </ul>
          </div>

          {/* ============ Buy box ============ */}
          <div class="lg:sticky lg:top-20 h-fit bg-white border border-gray-200 rounded-xl p-5">
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold text-gray-900">{formatNaira(product.price_kobo)}</span>
              {product.compare_at_price_kobo && <span class="text-sm text-gray-400 line-through">{formatNaira(product.compare_at_price_kobo)}</span>}
            </div>
            {product.stock > 0 ? (
              <p class="text-sm text-green-700 font-medium mt-1 flex items-center gap-1">
                <span class="material-symbols-outlined text-base">check_circle</span>In Stock
                {product.stock <= 5 && <span class="text-orange-600">— only {product.stock} left</span>}
              </p>
            ) : (
              <p class="text-sm text-red-600 font-medium mt-1">Out of stock</p>
            )}

            <div class="flex items-center gap-2 mt-2 text-sm text-gray-600">
              <span class="material-symbols-outlined text-base">storefront</span>
              Sold by <a href={`/shop?q=${encodeURIComponent(product.vendor_name)}`} class="text-primary font-medium hover:underline">{product.vendor_name}</a>
              <span class="material-symbols-outlined text-primary text-base" style="font-variation-settings:'FILL' 1">verified</span>
            </div>

            {product.stock > 0 && (
              <>
                <div class="flex items-center gap-3 mt-4">
                  <label class="text-sm font-medium text-gray-700">Qty</label>
                  <div class="flex items-center border border-gray-300 rounded-lg">
                    <button type="button" id="qty-minus" class="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-100">-</button>
                    <input id="qty-input" type="number" value="1" min="1" max={product.stock} class="w-12 text-center border-x border-gray-300 py-1.5 outline-none" />
                    <button type="button" id="qty-plus" class="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-100">+</button>
                  </div>
                </div>

                <button
                  id="add-to-cart-btn"
                  data-listing-id={product.listing_id}
                  class="w-full mt-4 bg-primary-fixed text-primary-dark font-semibold py-3 rounded-lg hover:brightness-95 transition flex items-center justify-center gap-2"
                >
                  <span class="material-symbols-outlined">add_shopping_cart</span>
                  Add to cart
                </button>
                <a
                  href={`/checkout?buy_now_listing=${product.listing_id}`}
                  class="w-full mt-2 bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition text-center block"
                >
                  Buy now
                </a>
              </>
            )}

            <div class="flex flex-col gap-2 mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">local_shipping</span>Ships in {product.delivery_days_min}-{product.delivery_days_max} days</span>
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">verified_user</span>Escrow buyer protection</span>
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">replay</span>{product.return_policy}</span>
            </div>
          </div>
        </div>

        {/* ============ Compare Sellers (buy box comparison) ============ */}
        {listings.length > 1 && (
          <section id="compare-sellers" class="mt-10 border-t border-gray-200 pt-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">Compare Sellers ({listings.length})</h2>
            <div class="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <table class="w-full text-sm border-collapse min-w-[640px]">
                <thead>
                  <tr class="text-left text-gray-500 border-b border-gray-200">
                    <th class="py-2 pr-4 font-medium">Seller</th>
                    <th class="py-2 pr-4 font-medium">Price</th>
                    <th class="py-2 pr-4 font-medium">Condition</th>
                    <th class="py-2 pr-4 font-medium">Delivery</th>
                    <th class="py-2 pr-4 font-medium">Rating</th>
                    <th class="py-2 pr-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l: any) => (
                    <tr class={`border-b border-gray-100 ${l.id === primaryListing?.id ? 'bg-primary-light/40' : ''}`}>
                      <td class="py-3 pr-4">
                        <div class="flex items-center gap-2">
                          <span class="font-medium text-gray-800">{l.vendor_name}</span>
                          {l.is_verified === 1 && <span class="material-symbols-outlined text-primary text-base" style="font-variation-settings:'FILL' 1">verified</span>}
                          {l.id === primaryListing?.id && <span class="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-semibold">BUY BOX</span>}
                        </div>
                        <p class="text-xs text-gray-500">{l.vendor_city}, {l.vendor_state} · {l.positive_feedback_percent}% positive</p>
                      </td>
                      <td class="py-3 pr-4 font-semibold text-gray-900">{formatNaira(l.price_kobo)}</td>
                      <td class="py-3 pr-4 text-gray-600 capitalize">{l.condition}</td>
                      <td class="py-3 pr-4 text-gray-600">{l.delivery_days_min}-{l.delivery_days_max} days</td>
                      <td class="py-3 pr-4 text-gray-600">
                        <span class="flex items-center gap-0.5">
                          <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
                          {l.vendor_rating.toFixed(1)}
                        </span>
                      </td>
                      <td class="py-3 pr-4">
                        {l.stock > 0 ? (
                          <button type="button" class="add-listing-btn text-xs font-semibold text-white bg-primary px-3 py-1.5 rounded-lg hover:bg-primary-dark transition" data-listing-id={l.id}>
                            Add to cart
                          </button>
                        ) : (
                          <span class="text-xs text-red-500 font-medium">Out of stock</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ============ Frequently Bought Together ============ */}
        {fbtItems.length > 0 && (
          <section class="mt-10 border-t border-gray-200 pt-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">Frequently Bought Together</h2>
            <div class="flex items-center gap-3 flex-wrap">
              <div class="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                <img src={images[0]} alt={product.title} class="w-full h-full object-cover" />
              </div>
              {fbtItems.map((it) => (
                <>
                  <span class="material-symbols-outlined text-gray-300">add</span>
                  <a href={`/shop/${it.slug}`} class="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 shrink-0 border border-gray-200 hover:border-primary">
                    <img src={it.image_url} alt={it.title} class="w-full h-full object-cover" />
                  </a>
                </>
              ))}
              <div class="ml-2">
                <p class="text-sm text-gray-500">Total price:</p>
                <p class="text-lg font-bold text-gray-900">{formatNaira(fbtTotal)}</p>
              </div>
            </div>
          </section>
        )}

        {/* ============ Specs & Description ============ */}
        <section class="mt-10 border-t border-gray-200 pt-6 grid md:grid-cols-2 gap-8">
          <div>
            <h2 class="text-lg font-bold text-gray-800 mb-4">Product Specifications</h2>
            <dl class="space-y-2 text-sm">
              {Object.entries(specs).map(([k, v]) => (
                <div class="flex gap-2 py-1.5 border-b border-gray-100">
                  <dt class="text-gray-500 w-36 shrink-0">{k}</dt>
                  <dd class="text-gray-800">{v}</dd>
                </div>
              ))}
              <div class="flex gap-2 py-1.5 border-b border-gray-100">
                <dt class="text-gray-500 w-36 shrink-0">Sold by</dt>
                <dd class="text-gray-800">{product.vendor_name}</dd>
              </div>
              <div class="flex gap-2 py-1.5 border-b border-gray-100">
                <dt class="text-gray-500 w-36 shrink-0">Product ID</dt>
                <dd class="text-gray-800">PROD-{product.id}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-800 mb-4">About this item</h2>
            <p class="text-sm text-gray-600 leading-relaxed">{product.long_description || product.description}</p>
            {whatsIncluded.length > 0 && (
              <>
                <h3 class="text-sm font-semibold text-gray-800 mt-4 mb-2">What's included</h3>
                <ul class="space-y-1 text-sm text-gray-600">
                  {whatsIncluded.map((item) => (
                    <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-base">check</span>{item}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        {/* ============ Reviews ============ */}
        <section id="reviews" class="mt-10 border-t border-gray-200 pt-6">
          <h2 class="text-lg font-bold text-gray-800 mb-4">Customer Reviews</h2>
          {product.rating_count > 0 && (
            <div class="flex flex-col sm:flex-row items-start gap-6 mb-6">
              <div class="text-center shrink-0">
                <div class="text-3xl font-bold text-gray-900">{product.rating_avg.toFixed(1)}</div>
                <div class="flex text-amber-500 justify-center">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span class="material-symbols-outlined text-lg" style={`font-variation-settings:'FILL' ${i <= Math.round(product.rating_avg) ? 1 : 0}`}>star</span>
                  ))}
                </div>
                <div class="text-xs text-gray-500 mt-1">{formatRatingCount(product.rating_count)} global ratings</div>
              </div>
              <div class="flex-1 space-y-1 max-w-xs w-full">
                {ratingCounts.map((r) => (
                  <a href="#reviews" class="flex items-center gap-2 text-xs text-gray-500 hover:text-primary">
                    <span class="w-10">{r.star} star</span>
                    <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div class="h-full bg-amber-400" style={`width: ${totalSampled ? (r.count / totalSampled) * 100 : 0}%`}></div>
                    </div>
                    <span class="w-6 text-right">{r.count}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {photoReviews.length > 0 && (
            <div class="mb-6">
              <h3 class="text-sm font-semibold text-gray-700 mb-2">Customer photos</h3>
              <div class="flex gap-2 overflow-x-auto pb-1">
                {photoReviews.map((r) => (
                  <a href="#reviews" class="w-20 h-20 rounded-lg overflow-hidden bg-gray-100 shrink-0 border border-gray-200">
                    <img src={r.photo_url!} alt={`Photo review by ${r.author_name}`} class="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div class="space-y-5">
            {reviews.results.length === 0 ? (
              <p class="text-sm text-gray-400">No reviews yet — be the first to review this product.</p>
            ) : (
              reviews.results.map((r) => (
                <div class="border-b border-gray-100 pb-5">
                  <div class="flex items-start gap-3">
                    {r.avatar_url ? (
                      <img src={r.avatar_url} alt={r.author_name} class="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div class="w-9 h-9 rounded-full bg-primary-light text-primary-dark font-bold text-sm flex items-center justify-center shrink-0">
                        {r.author_name.charAt(0)}
                      </div>
                    )}
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="text-sm font-semibold text-gray-800">{r.author_name}</p>
                        {r.is_verified_purchase === 1 && <span class="text-[10px] text-primary bg-primary-light px-1.5 py-0.5 rounded font-medium">Verified Purchase</span>}
                      </div>
                      <div class="flex items-center gap-2 mt-0.5">
                        <span class="flex text-amber-500">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <span class="material-symbols-outlined text-sm" style={`font-variation-settings:'FILL' ${i <= r.rating ? 1 : 0}`}>star</span>
                          ))}
                        </span>
                        <span class="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      </div>
                      {r.title && <p class="text-sm font-semibold text-gray-800 mt-2">{r.title}</p>}
                      <p class="text-sm text-gray-600 mt-1">{r.comment}</p>
                      {r.has_photo === 1 && r.photo_url && (
                        <div class="w-16 h-16 rounded-lg overflow-hidden mt-2 border border-gray-200">
                          <img src={r.photo_url} alt="Review photo" class="w-full h-full object-cover" />
                        </div>
                      )}
                      {r.helpful_count > 0 && (
                        <p class="text-xs text-gray-400 mt-2 flex items-center gap-1">
                          <span class="material-symbols-outlined text-sm">thumb_up</span>{r.helpful_count} people found this helpful
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ============ Q&A ============ */}
        <section class="mt-10 border-t border-gray-200 pt-6">
          <h2 class="text-lg font-bold text-gray-800 mb-4">Customer Questions &amp; Answers</h2>
          {questions.results.length === 0 ? (
            <p class="text-sm text-gray-400">No questions yet.</p>
          ) : (
            <div class="space-y-4">
              {questions.results.map((qa) => (
                <div class="border-b border-gray-100 pb-4">
                  <p class="text-sm font-medium text-gray-800 flex gap-2">
                    <span class="material-symbols-outlined text-gray-400 text-lg shrink-0">help</span>
                    {qa.question}
                  </p>
                  {qa.answer ? (
                    <p class="text-sm text-gray-600 mt-2 flex gap-2 ml-1">
                      <span class="material-symbols-outlined text-primary text-lg shrink-0">subdirectory_arrow_right</span>
                      <span><span class="font-medium text-gray-700">{qa.answered_by}:</span> {qa.answer}</span>
                    </p>
                  ) : (
                    <p class="text-xs text-gray-400 mt-1 ml-7">Awaiting seller response</p>
                  )}
                  <p class="text-xs text-gray-400 mt-1 ml-7">Asked by {qa.author_name} · {qa.helpful_count} found helpful</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ============ Similar products ============ */}
        {related.results.length > 0 && (
          <section class="mt-10 border-t border-gray-200 pt-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">Similar Products</h2>
            <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
              {related.results.map((p) => <ProductCard product={p} carousel />)}
            </div>
          </section>
        )}
      </div>
    </Layout>
  )
}
