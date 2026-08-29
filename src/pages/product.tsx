import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { ProductCard } from '../components/ProductCard'
import type { AppEnv, ProductRow, ReviewRow } from '../types'
import { formatNaira, discountPercent, formatRatingCount } from '../lib/money'

export async function productPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const slug = c.req.param('slug')

  const product = await db
    .prepare(
      `SELECT p.*, v.name as vendor_name, v.slug as vendor_slug, cat.name as category_name, cat.slug as category_slug
       FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       JOIN categories cat ON cat.id = p.category_id
       WHERE p.slug = ? AND p.is_active = 1`
    )
    .bind(slug)
    .first<ProductRow>()

  if (!product) {
    return c.render(
      <Layout title="Not found" user={user}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Product not found</h1>
          <a href="/shop" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to shop</a>
        </div>
      </Layout>,
      404
    )
  }

  const [reviews, related] = await Promise.all([
    db.prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20').bind(product.id).all<ReviewRow>(),
    db
      .prepare(
        `SELECT p.*, v.name as vendor_name FROM products p JOIN vendors v ON v.id = p.vendor_id
         WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1 LIMIT 6`
      )
      .bind(product.category_id, product.id)
      .all<ProductRow>()
  ])

  const discount = discountPercent(product.price_kobo, product.compare_at_price_kobo)

  // Rating breakdown (approximate distribution for display, based on avg)
  const ratingCounts = [5, 4, 3, 2, 1].map((star) => {
    const matches = reviews.results.filter((r) => r.rating === star).length
    return { star, count: matches }
  })

  return c.render(
    <Layout title={product.title} user={user}>
      <div class="max-w-5xl mx-auto px-6 lg:px-8 py-6">
        <div class="grid md:grid-cols-2 gap-8">
          {/* Image */}
          <div class="bg-gray-100 rounded-xl overflow-hidden aspect-square">
            <img src={product.image_url} alt={product.title} class="w-full h-full object-cover" />
          </div>

          {/* Info */}
          <div>
            <a href={`/shop?category=${product.category_slug}`} class="text-xs text-primary font-medium">{product.category_name}</a>
            <h1 class="text-2xl font-bold text-gray-900 mt-1">{product.title}</h1>
            <p class="text-sm text-gray-500 mt-1">Sold by <span class="font-medium text-gray-700">{product.vendor_name}</span></p>

            {product.rating_count > 0 && (
              <div class="flex items-center gap-1 text-sm text-gray-600 mt-2">
                <span class="material-symbols-outlined text-amber-500 text-lg" style="font-variation-settings:'FILL' 1">star</span>
                <span class="font-semibold">{product.rating_avg.toFixed(1)}</span>
                <span>({formatRatingCount(product.rating_count)})</span>
              </div>
            )}

            <div class="flex items-baseline gap-3 mt-4">
              <span class="text-3xl font-bold text-gray-900">{formatNaira(product.price_kobo)}</span>
              {product.compare_at_price_kobo && (
                <>
                  <span class="text-lg text-gray-400 line-through">{formatNaira(product.compare_at_price_kobo)}</span>
                  <span class="text-sm font-semibold text-red-600">Save {discount}% off</span>
                </>
              )}
            </div>

            <p class="text-gray-600 mt-4">{product.description}</p>

            <ul class="mt-4 space-y-1.5 text-sm text-gray-600">
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">check_circle</span>Rated {product.rating_avg.toFixed(1)}/5 by {formatRatingCount(product.rating_count)} buyers</li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">check_circle</span>Ships from a verified NaijaShop vendor</li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">check_circle</span>Covered by NaijaDeals Buyer Protection: pay into escrow, confirm before release</li>
            </ul>

            {product.stock > 0 ? (
              <>
                <div class="flex items-center gap-3 mt-6">
                  <label class="text-sm font-medium text-gray-700">Quantity</label>
                  <div class="flex items-center border border-gray-300 rounded-lg">
                    <button type="button" id="qty-minus" class="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-100">-</button>
                    <input id="qty-input" type="number" value="1" min="1" max={product.stock} class="w-12 text-center border-x border-gray-300 py-1.5 outline-none" />
                    <button type="button" id="qty-plus" class="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-100">+</button>
                  </div>
                </div>

                <div class="flex gap-3 mt-4">
                  <button
                    id="add-to-cart-btn"
                    data-product-id={product.id}
                    class="flex-1 bg-primary-fixed text-primary-dark font-semibold py-3 rounded-lg hover:brightness-95 transition flex items-center justify-center gap-2"
                  >
                    <span class="material-symbols-outlined">add_shopping_cart</span>
                    Add to cart
                  </button>
                  <a
                    href={`/checkout?buy_now=${product.id}`}
                    class="flex-1 bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition text-center"
                  >
                    Buy now
                  </a>
                </div>
              </>
            ) : (
              <div class="mt-6 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">Out of stock</div>
            )}

            <div class="flex items-center gap-4 mt-4 text-xs text-gray-500">
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-base">verified_user</span>Escrow protected</span>
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-base">local_shipping</span>Fast delivery</span>
            </div>
          </div>
        </div>

        {/* Product details table */}
        <section class="mt-10 border-t border-gray-200 pt-6">
          <h2 class="text-lg font-bold text-gray-800 mb-4">Product details</h2>
          <dl class="grid sm:grid-cols-2 gap-y-3 text-sm">
            <div class="flex gap-2"><dt class="text-gray-500 w-32">Category</dt><dd class="text-gray-800">{product.category_name}</dd></div>
            <div class="flex gap-2"><dt class="text-gray-500 w-32">Sold by</dt><dd class="text-gray-800">{product.vendor_name}</dd></div>
            <div class="flex gap-2"><dt class="text-gray-500 w-32">Product ID</dt><dd class="text-gray-800">PROD-{product.id}</dd></div>
            <div class="flex gap-2"><dt class="text-gray-500 w-32">Stock</dt><dd class="text-gray-800">{product.stock} units available</dd></div>
            <div class="flex gap-2 sm:col-span-2"><dt class="text-gray-500 w-32 shrink-0">Return policy</dt><dd class="text-gray-800">{product.return_policy}</dd></div>
            <div class="flex gap-2 sm:col-span-2"><dt class="text-gray-500 w-32 shrink-0">Payment options</dt><dd class="text-gray-800">NaijaDeals Wallet, card or bank transfer via Paystack</dd></div>
          </dl>
        </section>

        {/* Reviews */}
        <section class="mt-10 border-t border-gray-200 pt-6">
          <h2 class="text-lg font-bold text-gray-800 mb-4">Customer reviews</h2>
          {product.rating_count > 0 && (
            <div class="flex items-center gap-6 mb-6">
              <div class="text-center">
                <div class="text-3xl font-bold text-gray-900">{product.rating_avg.toFixed(1)}</div>
                <div class="flex text-amber-500 justify-center">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span class="material-symbols-outlined text-lg" style={`font-variation-settings:'FILL' ${i <= Math.round(product.rating_avg) ? 1 : 0}`}>star</span>
                  ))}
                </div>
                <div class="text-xs text-gray-500 mt-1">{formatRatingCount(product.rating_count)} ratings</div>
              </div>
              <div class="flex-1 space-y-1 max-w-xs">
                {ratingCounts.map((r) => (
                  <div class="flex items-center gap-2 text-xs text-gray-500">
                    <span class="w-8">{r.star}star</span>
                    <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div class="h-full bg-amber-400" style={`width: ${reviews.results.length ? (r.count / reviews.results.length) * 100 : 0}%`}></div>
                    </div>
                    <span class="w-6 text-right">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div class="space-y-4">
            {reviews.results.length === 0 ? (
              <p class="text-sm text-gray-400">No reviews yet.</p>
            ) : (
              reviews.results.map((r) => (
                <div class="border-b border-gray-100 pb-4">
                  <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-primary-light text-primary-dark font-bold text-sm flex items-center justify-center">
                      {r.author_name.charAt(0)}
                    </div>
                    <div>
                      <p class="text-sm font-semibold text-gray-800">{r.author_name}</p>
                      <div class="flex text-amber-500">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <span class="material-symbols-outlined text-sm" style={`font-variation-settings:'FILL' ${i <= r.rating ? 1 : 0}`}>star</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p class="text-sm text-gray-600 mt-2">{r.comment}</p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Related */}
        {related.results.length > 0 && (
          <section class="mt-10 border-t border-gray-200 pt-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">Customers frequently viewed</h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              {related.results.map((p) => <ProductCard product={p} />)}
            </div>
          </section>
        )}
      </div>
    </Layout>
  )
}
