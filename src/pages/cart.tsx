import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv, CartItemRow } from '../types'
import { getOrCreateCartId, getCartItems, getSavedForLaterItems, groupByVendor, groupByCurrency } from '../lib/cart'
import { getOrSetGuestToken } from '../lib/guest'
import { formatNaira, formatMoney } from '../lib/money'

/** One line item row — always keyed by cart_items.id (`item.id`), NEVER by product_id. Two different
 * cart rows can share the same product_id (bought from two different sellers), so product_id would
 * be ambiguous as a DOM/data key here; cart_items.id is the only value guaranteed unique per row. */
function CartRow({ item }: { item: CartItemRow }) {
  return (
    <div class="flex gap-4 bg-white border border-gray-200 rounded-xl p-4" data-cart-item data-cart-item-id={item.id} data-listing-id={item.listing_id}>
      <a href={`/shop/${item.slug}`} class="w-20 h-20 shrink-0 rounded-lg bg-gray-100 overflow-hidden">
        <img src={item.image_url} alt={item.title} class="w-full h-full object-cover" />
      </a>
      <div class="flex-1 min-w-0">
        <a href={`/shop/${item.slug}`} class="text-sm font-medium text-gray-800 hover:text-primary line-clamp-2">{item.title}</a>
        {item.variant_value && <p class="text-xs text-gray-500 mt-0.5">Option: {item.variant_value}</p>}
        <div class="flex items-baseline gap-2 mt-1">
          <p class="text-sm font-bold text-gray-900">{formatMoney(item.price_kobo, item.currency)}</p>
          {item.compare_at_price_kobo && item.compare_at_price_kobo > item.price_kobo && (
            <p class="text-xs text-gray-400 line-through">{formatMoney(item.compare_at_price_kobo, item.currency)}</p>
          )}
        </div>
        {item.quantity > item.stock && (
          <p class="text-xs text-red-600 mt-1 font-medium">Only {item.stock} left in stock — please reduce quantity</p>
        )}
        <div class="flex items-center gap-3 mt-2 flex-wrap">
          <div class="flex items-center border border-gray-300 rounded-lg">
            <button type="button" class="cart-qty-minus w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100" data-cart-item-id={item.id}>-</button>
            <span class="cart-qty-value w-10 text-center text-sm">{item.quantity}</span>
            <button type="button" class="cart-qty-plus w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100" data-cart-item-id={item.id}>+</button>
          </div>
          <button type="button" class="cart-save-later-btn text-xs text-gray-500 font-medium hover:text-primary hover:underline" data-cart-item-id={item.id}>
            Save for later
          </button>
          <button type="button" class="cart-remove-btn text-xs text-red-600 font-medium hover:underline" data-cart-item-id={item.id}>
            Remove
          </button>
        </div>
      </div>
      <div class="text-right shrink-0">
        <p class="line-total text-sm font-bold text-gray-900">{formatMoney(item.price_kobo * item.quantity, item.currency)}</p>
      </div>
    </div>
  )
}

function SavedRow({ item }: { item: CartItemRow }) {
  return (
    <div class="flex gap-4 bg-white border border-gray-200 rounded-xl p-4" data-saved-item data-cart-item-id={item.id}>
      <a href={`/shop/${item.slug}`} class="w-16 h-16 shrink-0 rounded-lg bg-gray-100 overflow-hidden">
        <img src={item.image_url} alt={item.title} class="w-full h-full object-cover" />
      </a>
      <div class="flex-1 min-w-0">
        <a href={`/shop/${item.slug}`} class="text-sm font-medium text-gray-800 hover:text-primary line-clamp-2">{item.title}</a>
        <p class="text-xs text-gray-500 mt-0.5">Sold by {item.vendor_name}</p>
        <p class="text-sm font-bold text-gray-900 mt-1">{formatMoney(item.price_kobo, item.currency)}</p>
        <div class="flex items-center gap-3 mt-2">
          <button type="button" class="saved-move-to-cart-btn text-xs text-primary font-semibold hover:underline" data-cart-item-id={item.id}>
            Move to cart
          </button>
          <button type="button" class="saved-remove-btn text-xs text-red-600 font-medium hover:underline" data-cart-item-id={item.id}>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

export async function cartPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const guestToken = user ? null : getOrSetGuestToken(c)
  const cartId = await getOrCreateCartId(db, user?.id ?? null, guestToken)
  const [items, saved] = await Promise.all([getCartItems(db, cartId), getSavedForLaterItems(db, cartId)])
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  const cartCount = items.reduce((s, i) => s + i.quantity, 0)
  const sellerGroups = Array.from(groupByVendor(items).entries())
  const currencyGroups = Array.from(groupByCurrency(items).entries())
  const isMultiCurrency = currencyGroups.length > 1

  return c.render(
    <Layout title="Your Cart" user={user} cartCount={cartCount} locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <h1 class="text-2xl font-bold text-gray-800 mb-6">Your Cart</h1>

        {items.length === 0 && saved.length === 0 ? (
          <div class="text-center py-20">
            <span class="material-symbols-outlined text-5xl text-gray-300">shopping_cart</span>
            <p class="text-gray-500 mt-3">Your cart is empty.</p>
            <a href="/shop" class="inline-block mt-4 bg-primary text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition">
              Start shopping
            </a>
          </div>
        ) : (
          <div class="grid md:grid-cols-3 gap-8">
            <div class="md:col-span-2 space-y-6">
              {items.length > 0 && (
                <div id="cart-items-list" class="space-y-6">
                  {sellerGroups.map(([vendorId, group]) => (
                    <div class="space-y-3" data-seller-group data-vendor-id={vendorId}>
                      <div class="flex items-center gap-2 pb-1 border-b border-gray-200">
                        <span class="material-symbols-outlined text-primary text-base">storefront</span>
                        <span class="text-sm font-bold text-gray-800">{group.vendorName}</span>
                        <span class="text-xs text-gray-400">— {group.items.length} item{group.items.length > 1 ? 's' : ''} shipped by this seller</span>
                      </div>
                      <div class="space-y-3">
                        {group.items.map((item) => <CartRow item={item} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {items.length === 0 && (
                <div class="text-center py-10 bg-white border border-gray-200 rounded-xl">
                  <span class="material-symbols-outlined text-4xl text-gray-300">shopping_cart</span>
                  <p class="text-gray-500 mt-2 text-sm">Your cart is empty — items saved for later are below.</p>
                  <a href="/shop" class="text-primary font-semibold hover:underline mt-2 inline-block text-sm">Continue shopping</a>
                </div>
              )}

              {saved.length > 0 && (
                <div>
                  <h2 class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-base">bookmark</span>
                    Saved for later ({saved.length})
                  </h2>
                  <div id="saved-items-list" class="space-y-3">
                    {saved.map((item) => <SavedRow item={item} />)}
                  </div>
                </div>
              )}
            </div>

            <div class="bg-white border border-gray-200 rounded-xl p-5 h-fit sticky top-20">
              <h2 class="font-bold text-gray-800 mb-3">Order Summary</h2>
              {/*
                Stage 2C (Currency & Address Foundation): BOTH blocks below are always
                present in the DOM (one hidden), never conditionally omitted, so the
                client-side AJAX handler in app.js (initCartPage's applyCartSummary) can
                toggle between them purely by currency_groups.length from a live
                /api/cart response — without ever needing a full page reload just
                because a quantity change happened to be the trigger. Server-side
                render still decides which one starts visible, from the same
                isMultiCurrency computed above.
              */}
              <div id="cart-summary-currency-groups" class={`text-sm text-gray-600 mb-1.5 space-y-1 ${isMultiCurrency ? '' : 'hidden'}`}>
                {currencyGroups.map(([currency, group]) => (
                  <div class="flex justify-between" data-currency-row data-currency={currency}>
                    <span>{currency} subtotal (<span class="currency-row-count">{group.items.reduce((s, i) => s + i.quantity, 0)}</span> item{group.items.reduce((s, i) => s + i.quantity, 0) > 1 ? 's' : ''})</span>
                    <span class="currency-row-subtotal">{formatMoney(group.subtotalMinor, currency)}</span>
                  </div>
                ))}
                <p class="text-xs text-amber-600 font-medium pt-0.5">Items from different currency zones — totals are shown per currency group.</p>
              </div>
              <div id="cart-summary-single-currency" class={`flex justify-between text-sm text-gray-600 mb-1.5 ${isMultiCurrency ? 'hidden' : ''}`}>
                <span>Subtotal (<span id="cart-summary-count">{cartCount}</span> items)</span>
                <span id="cart-summary-subtotal" data-currency={currencyGroups[0]?.[0] ?? 'NGN'}>{formatMoney(subtotal, currencyGroups[0]?.[0] ?? 'NGN')}</span>
              </div>
              {sellerGroups.length > 0 && (
                <p class="text-xs text-gray-500 mb-1.5">
                  {sellerGroups.length} seller{sellerGroups.length > 1 ? 's' : ''} — each ships independently
                </p>
              )}
              <p class="text-xs text-gray-400 mb-3">Delivery fees and any discounts are calculated at checkout.</p>
              <div class="border-t border-gray-100 pt-3">
                {items.length === 0 ? (
                  <button disabled class="block w-full text-center bg-gray-200 text-gray-400 font-semibold py-3 rounded-lg cursor-not-allowed">
                    Proceed to Checkout
                  </button>
                ) : user ? (
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
