import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { getOrCreateCartId, getCartItems, addToCart } from '../lib/cart'
import { getWalletBalance } from '../lib/wallet'
import { formatNaira } from '../lib/money'

const FLAT_DELIVERY_FEE_KOBO = 150000 // kept in sync with src/lib/orders.ts — see note there

/** Landing page the customer is redirected to after paying on Paystack's hosted checkout. */
export async function checkoutCallbackPage(c: Context<AppEnv>) {
  const user = c.get('user')

  return c.render(
    <Layout title="Confirming payment" user={user}>
      <div class="max-w-md mx-auto px-6 py-24 text-center">
        <span class="material-symbols-outlined text-4xl text-primary animate-spin">progress_activity</span>
        <p id="checkout-callback-status" class="text-gray-600 mt-4">Confirming your payment, please wait...</p>
      </div>
    </Layout>
  )
}

export async function checkoutPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const buyNowProductId = c.req.query('buy_now')

  const cartId = await getOrCreateCartId(db, user.id, null)

  // "Buy now" from the PDP: add that single product to the user's cart, then
  // continue through the normal checkout flow. Any other items already in
  // the cart are also shown — MVP tradeoff, documented for Pat.
  if (buyNowProductId) {
    const product = await db.prepare('SELECT id, stock FROM products WHERE id = ? AND is_active = 1')
      .bind(Number(buyNowProductId))
      .first<{ id: number; stock: number }>()
    if (product && product.stock > 0) {
      await addToCart(db, cartId, product.id, 1)
    }
  }

  const items = await getCartItems(db, cartId)
  const cartCount = items.reduce((s, i) => s + i.quantity, 0)

  if (items.length === 0) {
    return c.render(
      <Layout title="Checkout" user={user}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">shopping_cart</span>
          <h1 class="text-xl font-bold mt-4">Your cart is empty</h1>
          <a href="/shop" class="text-primary font-semibold hover:underline mt-2 inline-block">Continue shopping</a>
        </div>
      </Layout>
    )
  }

  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  const total = subtotal + FLAT_DELIVERY_FEE_KOBO
  const walletBalance = await getWalletBalance(db, user.id)
  const insufficientWallet = walletBalance < total

  return c.render(
    <Layout title="Checkout" user={user} cartCount={cartCount}>
      <div class="max-w-5xl mx-auto px-6 lg:px-8 py-6">
        <h1 class="text-2xl font-bold text-gray-800 mb-6">Checkout</h1>

        <div class="grid md:grid-cols-3 gap-8">
          <form id="checkout-form" class="md:col-span-2 space-y-6">
            <section class="bg-white border border-gray-200 rounded-xl p-5">
              <h2 class="font-bold text-gray-800 mb-4">Shipping details</h2>
              <div class="grid sm:grid-cols-2 gap-4">
                <div class="sm:col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Full name</label>
                  <input name="name" required value={user.name} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div class="sm:col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
                  <input name="phone" required value={user.phone ?? ''} placeholder="080XXXXXXXX" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div class="sm:col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Delivery address</label>
                  <input name="address" required placeholder="Street address, house number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input name="city" required placeholder="e.g. Ikeja" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input name="state" required placeholder="e.g. Lagos" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
            </section>

            <section class="bg-white border border-gray-200 rounded-xl p-5">
              <h2 class="font-bold text-gray-800 mb-4">Payment method</h2>
              <div class="space-y-2">
                <label class="flex items-center gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="radio" name="payment_method" value="wallet" checked={!insufficientWallet} disabled={insufficientWallet} />
                  <span class="material-symbols-outlined text-primary">account_balance_wallet</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-800">Pay from NaijaDeals Wallet</p>
                    <p class="text-xs text-gray-500">Balance: {formatNaira(walletBalance)}{insufficientWallet ? ' — insufficient, top up or pay by card' : ''}</p>
                  </div>
                </label>
                <label class="flex items-center gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="radio" name="payment_method" value="paystack" checked={insufficientWallet} />
                  <span class="material-symbols-outlined text-primary">credit_card</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-800">Pay by card / bank transfer</p>
                    <p class="text-xs text-gray-500">Powered by Paystack</p>
                  </div>
                </label>
              </div>
            </section>

            <div id="checkout-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg"></div>

            <button type="submit" id="place-order-btn" class="w-full bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition">
              Place order — {formatNaira(total)}
            </button>
          </form>

          <div class="bg-white border border-gray-200 rounded-xl p-5 h-fit">
            <h2 class="font-bold text-gray-800 mb-3">Order Summary</h2>
            <div class="space-y-2 mb-3 max-h-56 overflow-y-auto">
              {items.map((item) => (
                <div class="flex justify-between text-sm text-gray-600">
                  <span class="line-clamp-1">{item.title} × {item.quantity}</span>
                  <span class="shrink-0 ml-2">{formatNaira(item.price_kobo * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div class="border-t border-gray-100 pt-3 space-y-1.5">
              <div class="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span>
                <span>{formatNaira(subtotal)}</span>
              </div>
              <div class="flex justify-between text-sm text-gray-600">
                <span>Delivery fee</span>
                <span>{formatNaira(FLAT_DELIVERY_FEE_KOBO)}</span>
              </div>
              <div class="flex justify-between text-base font-bold text-gray-900 pt-1.5 border-t border-gray-100">
                <span>Total</span>
                <span>{formatNaira(total)}</span>
              </div>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-gray-500 mt-3">
              <span class="material-symbols-outlined text-base">verified_user</span>
              Escrow protected — funds are only released to the vendor after you confirm delivery
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
