import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { formatNaira, discountPercent } from '../lib/money'
import { getWishlistForUser } from '../lib/wishlist'

export async function wishlistPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!

  const items = await getWishlistForUser(db, user.id)

  return c.render(
    <Layout title="Your Wishlist" user={user} wishlistCount={items.length}>
      <div class="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between mb-2">
          <h1 class="text-xl md:text-2xl font-bold text-gray-800">Your Wishlist</h1>
          <a href="/account" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 shrink-0">
            <span class="material-symbols-outlined text-base">arrow_back</span>Account
          </a>
        </div>
        <p class="text-sm text-gray-500 mb-6">{items.length} {items.length === 1 ? 'item' : 'items'} saved for later</p>

        {items.length === 0 ? (
          <div class="text-center py-20 bg-white border border-gray-200 rounded-xl">
            <span class="material-symbols-outlined text-5xl text-gray-300">favorite_border</span>
            <p class="text-gray-500 mt-3">Your wishlist is empty.</p>
            <a href="/shop" class="inline-block mt-4 bg-primary text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition">
              Browse products
            </a>
          </div>
        ) : (
          <div id="wishlist-grid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => {
              const discount = discountPercent(item.price_kobo, item.compare_at_price_kobo)
              const outOfStock = item.stock <= 0
              return (
                <div class="wishlist-card group flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow" data-product-id={item.id}>
                  <a href={`/shop/${item.slug}`} class="relative aspect-square bg-gray-100 overflow-hidden block">
                    <img src={item.image_url} alt={item.title} loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    {discount && (
                      <span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded">-{discount}%</span>
                    )}
                    <button
                      type="button"
                      aria-label="Remove from wishlist"
                      class="wishlist-remove-btn absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
                      data-product-id={item.id}
                    >
                      <span class="material-symbols-outlined text-lg" style="font-variation-settings:'FILL' 1">favorite</span>
                    </button>
                  </a>
                  <div class="p-3 flex flex-col gap-1 flex-1">
                    <a href={`/shop/${item.slug}`} class="hover:underline">
                      <h3 class="text-sm text-gray-800 line-clamp-2 min-h-[2.5rem]">{item.title}</h3>
                    </a>
                    <p class="text-xs text-gray-500 flex items-center gap-1">
                      <span class="material-symbols-outlined text-xs">storefront</span>
                      Sold by <a href={`/shop?vendor=${item.vendor_slug}`} class="text-primary hover:underline">{item.vendor_name}</a>
                    </p>
                    <div class="flex items-baseline gap-2 mt-1">
                      <span class="text-base font-bold text-gray-900">{formatNaira(item.price_kobo)}</span>
                      {item.compare_at_price_kobo && (
                        <span class="text-xs text-gray-400 line-through">{formatNaira(item.compare_at_price_kobo)}</span>
                      )}
                    </div>
                    {outOfStock ? (
                      <span class="text-[11px] text-red-600 font-medium">Out of stock</span>
                    ) : item.stock <= 5 ? (
                      <span class="text-[11px] text-orange-600 font-medium">Only {item.stock} left</span>
                    ) : (
                      <span class="text-[11px] text-primary font-medium flex items-center gap-0.5">
                        <span class="material-symbols-outlined text-xs">check_circle</span>In stock
                      </span>
                    )}
                    <p class="text-[11px] text-gray-400">Saved {new Date(item.wishlisted_at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</p>
                    <div class="flex gap-2 mt-2">
                      <button
                        type="button"
                        class="wishlist-move-to-cart-btn flex-1 bg-primary text-white text-xs font-semibold py-2 rounded-lg hover:bg-primary-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
                        data-product-id={item.id}
                        disabled={outOfStock}
                      >
                        Move to cart
                      </button>
                      <button
                        type="button"
                        class="wishlist-remove-btn text-gray-400 hover:text-red-600 text-xs font-medium px-2 rounded-lg transition"
                        data-product-id={item.id}
                        aria-label="Remove"
                      >
                        <span class="material-symbols-outlined text-lg">delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
