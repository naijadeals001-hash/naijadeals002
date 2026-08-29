import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { getOrCreateCartId, getCartItems } from '../lib/cart'
import { getOrSetGuestToken } from '../lib/guest'
import { formatNaira } from '../lib/money'

export async function cartPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const guestToken = user ? null : getOrSetGuestToken(c)
  const cartId = await getOrCreateCartId(db, user?.id ?? null, guestToken)
  const items = await getCartItems(db, cartId)
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  const cartCount = items.reduce((s, i) => s + i.quantity, 0)

  return c.render(
    <Layout title="Your Cart" user={user} cartCount={cartCount}>
      <div class="max-w-5xl mx-auto px-6 lg:px-8 py-6">
        <h1 class="text-2xl font-bold text-gray-800 mb-6">Your Cart</h1>

        {items.length === 0 ? (
          <div class="text-center py-20">
            <span class="material-symbols-outlined text-5xl text-gray-300">shopping_cart</span>
            <p class="text-gray-500 mt-3">Your cart is empty.</p>
            <a href="/shop" class="inline-block mt-4 bg-primary text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition">
              Start shopping
            </a>
          </div>
        ) : (
          <div class="grid md:grid-cols-3 gap-8">
            <div class="md:col-span-2 space-y-4" id="cart-items-list">
              {items.map((item) => (
                <div class="flex gap-4 bg-white border border-gray-200 rounded-xl p-4" data-cart-item data-product-id={item.product_id}>
                  <a href={`/shop/${item.slug}`} class="w-20 h-20 shrink-0 rounded-lg bg-gray-100 overflow-hidden">
                    <img src={item.image_url} alt={item.title} class="w-full h-full object-cover" />
                  </a>
                  <div class="flex-1 min-w-0">
                    <a href={`/shop/${item.slug}`} class="text-sm font-medium text-gray-800 hover:text-primary line-clamp-2">{item.title}</a>
                    <p class="text-sm font-bold text-gray-900 mt-1">{formatNaira(item.price_kobo)}</p>
                    {item.quantity > item.stock && (
                      <p class="text-xs text-red-600 mt-1">Only {item.stock} left in stock</p>
                    )}
                    <div class="flex items-center gap-3 mt-2">
                      <div class="flex items-center border border-gray-300 rounded-lg">
                        <button type="button" class="cart-qty-minus w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100" data-product-id={item.product_id}>-</button>
                        <span class="cart-qty-value w-10 text-center text-sm">{item.quantity}</span>
                        <button type="button" class="cart-qty-plus w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100" data-product-id={item.product_id}>+</button>
                      </div>
                      <button type="button" class="cart-remove-btn text-xs text-red-600 font-medium hover:underline" data-product-id={item.product_id}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="line-total text-sm font-bold text-gray-900">{formatNaira(item.price_kobo * item.quantity)}</p>
                  </div>
                </div>
              ))}
            </div>

            <div class="bg-white border border-gray-200 rounded-xl p-5 h-fit">
              <h2 class="font-bold text-gray-800 mb-3">Order Summary</h2>
              <div class="flex justify-between text-sm text-gray-600 mb-1.5">
                <span>Subtotal (<span id="cart-summary-count">{cartCount}</span> items)</span>
                <span id="cart-summary-subtotal">{formatNaira(subtotal)}</span>
              </div>
              <p class="text-xs text-gray-400 mb-3">Delivery fee calculated at checkout.</p>
              <div class="border-t border-gray-100 pt-3">
                {user ? (
                  <a href="/checkout" class="block text-center bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition">
                    Proceed to Checkout
                  </a>
                ) : (
                  <a href="/login?next=/checkout" class="block text-center bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition">
                    Sign in to Checkout
                  </a>
                )}
              </div>
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mt-3">
                <span class="material-symbols-outlined text-base">verified_user</span>
                Escrow protected — pay in, confirm delivery before release
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
