import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv, CartItemRow } from '../types'
import { getOrCreateCartId, getCartItems, getBuyNowItem, groupByVendor } from '../lib/cart'
import { getAddressesForUser } from '../lib/addresses'
import { getWalletBalance } from '../lib/wallet'
import { calculateDeliveryFeeKobo, DELIVERY_FEE_PER_SELLER_KOBO, countDistinctVendors } from '../lib/orders'
import { formatNaira } from '../lib/money'

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

  // ---------- Resolve items: either the persisted cart, or a single fresh-resolved "Buy Now" listing ----------
  const buyNowListingId = c.req.query('buy_now_listing')
  const buyNowQty = Math.max(1, parseInt(c.req.query('qty') || '1', 10) || 1)
  const isBuyNow = Boolean(buyNowListingId)

  let items: CartItemRow[]
  let buyNowPayload: { listing_id: number; quantity: number } | null = null

  if (isBuyNow) {
    const item = await getBuyNowItem(db, Number(buyNowListingId), buyNowQty)
    if (!item || item.stock <= 0) {
      return c.render(
        <Layout title="Checkout" user={user}>
          <div class="max-w-2xl mx-auto text-center py-20">
            <span class="material-symbols-outlined text-5xl text-gray-300">error</span>
            <h1 class="text-xl font-bold mt-4">This listing is no longer available</h1>
            <a href="/shop" class="text-primary font-semibold hover:underline mt-2 inline-block">Continue shopping</a>
          </div>
        </Layout>
      )
    }
    items = [item]
    buyNowPayload = { listing_id: item.listing_id, quantity: item.quantity }
  } else {
    const cartId = await getOrCreateCartId(db, user.id, null)
    items = await getCartItems(db, cartId)
  }

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

  const cartCount = items.reduce((s, i) => s + i.quantity, 0)
  const subtotal = items.reduce((sum, i) => sum + i.price_kobo * i.quantity, 0)
  const sellerCount = countDistinctVendors(items)
  const sellerGroups = Array.from(groupByVendor(items).entries())
  const deliveryFeeStandard = calculateDeliveryFeeKobo(items, 'standard')
  const deliveryFeeExpress = calculateDeliveryFeeKobo(items, 'express')
  const [addresses, walletBalance] = await Promise.all([getAddressesForUser(db, user.id), getWalletBalance(db, user.id)])

  // Server-computed initial totals (standard delivery, no coupon) — JS recomputes live from here
  // via /api/cart/preview whenever delivery method or coupon changes, so what's on screen always
  // matches what /api/orders/checkout will actually charge.
  const initialTotal = subtotal + deliveryFeeStandard

  const initState = {
    isBuyNow,
    buyNow: buyNowPayload,
    subtotalKobo: subtotal,
    deliveryFeeStandardKobo: deliveryFeeStandard,
    deliveryFeeExpressKobo: deliveryFeeExpress,
    sellerCount,
    walletBalanceKobo: walletBalance,
    defaultAddressId: addresses.find((a) => a.is_default === 1)?.id ?? addresses[0]?.id ?? null
  }

  return c.render(
    <Layout title="Checkout" user={user} cartCount={cartCount}>
      <div class="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <h1 class="text-2xl font-bold text-gray-800 mb-2">Checkout</h1>
        {isBuyNow && (
          <p class="text-sm text-primary bg-primary-light inline-block px-3 py-1 rounded-full mb-4 font-medium">
            <span class="material-symbols-outlined text-sm align-middle mr-1">bolt</span>Buy Now — express single-item checkout
          </p>
        )}

        {/* Step indicator */}
        <div id="checkout-stepper" class="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {[
            { n: 1, label: 'Address' },
            { n: 2, label: 'Delivery' },
            { n: 3, label: 'Review' },
            { n: 4, label: 'Payment' }
          ].map((s) => (
            <button type="button" class={`checkout-step-tab shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${s.n === 1 ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-500'}`} data-step-tab={s.n}>
              <span class="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs">{s.n}</span>
              {s.label}
            </button>
          ))}
        </div>

        <div class="grid lg:grid-cols-3 gap-8">
          <div class="lg:col-span-2 space-y-6 min-w-0">
            {/* ============ STEP 1: Delivery Address ============ */}
            <section class="checkout-step bg-white border border-gray-200 rounded-xl p-5" data-step="1">
              <h2 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">location_on</span>Delivery address
              </h2>

              <div id="address-list" class="space-y-2">
                {addresses.length === 0 && (
                  <p class="text-sm text-gray-500 mb-2">You don't have any saved addresses yet — add one below.</p>
                )}
                {addresses.map((addr) => (
                  <label class="flex items-start gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light" data-address-option data-address-id={addr.id}>
                    <input type="radio" name="address_id" value={addr.id} checked={addr.id === initState.defaultAddressId} class="mt-1" />
                    <div class="flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-semibold text-gray-800">{addr.label}</span>
                        {addr.is_default === 1 && <span class="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-semibold">DEFAULT</span>}
                      </div>
                      <p class="text-sm text-gray-600 mt-0.5">{addr.recipient_name} · {addr.phone}</p>
                      <p class="text-sm text-gray-600">{addr.line1}, {addr.city}, {addr.state}</p>
                    </div>
                  </label>
                ))}
              </div>

              <button type="button" id="show-new-address-btn" class="text-sm text-primary font-semibold hover:underline mt-3 flex items-center gap-1">
                <span class="material-symbols-outlined text-base">add</span>Add a new address
              </button>

              <div id="new-address-form" class="hidden mt-4 border-t border-gray-100 pt-4 grid sm:grid-cols-2 gap-3">
                <div class="sm:col-span-2">
                  <label class="block text-xs font-medium text-gray-700 mb-1">Address label</label>
                  <input id="na-label" placeholder="e.g. Home, Office" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Recipient name</label>
                  <input id="na-recipient" value={user.name} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Phone number</label>
                  <input id="na-phone" value={user.phone ?? ''} placeholder="080XXXXXXXX" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div class="sm:col-span-2">
                  <label class="block text-xs font-medium text-gray-700 mb-1">Street address</label>
                  <input id="na-line1" placeholder="Street address, house number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">City</label>
                  <input id="na-city" placeholder="e.g. Ikeja" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">State</label>
                  <input id="na-state" placeholder="e.g. Lagos" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div id="new-address-error" class="hidden sm:col-span-2 text-red-600 text-xs"></div>
                <div class="sm:col-span-2 flex gap-2">
                  <button type="button" id="save-new-address-btn" class="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition">Save address</button>
                  <button type="button" id="cancel-new-address-btn" class="text-gray-500 text-sm font-medium px-4 py-2 hover:bg-gray-50 rounded-lg">Cancel</button>
                </div>
              </div>

              <button type="button" class="checkout-next-btn w-full mt-5 bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition" data-next-step="2">
                Continue to delivery method
              </button>
            </section>

            {/* ============ STEP 2: Delivery Method ============ */}
            <section class="checkout-step bg-white border border-gray-200 rounded-xl p-5 hidden" data-step="2">
              <h2 class="font-bold text-gray-800 mb-1 flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">local_shipping</span>Delivery method
              </h2>
              <p class="text-xs text-gray-500 mb-4">
                Your order ships from {sellerCount} seller{sellerCount > 1 ? 's' : ''} — each seller's package is delivered independently, so delivery fees are charged per seller.
              </p>
              <div class="space-y-2">
                <label class="flex items-center gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="radio" name="delivery_method" value="standard" checked id="delivery-standard-radio" />
                  <span class="material-symbols-outlined text-primary">local_shipping</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-800">Standard delivery — 3-7 business days</p>
                    <p class="text-xs text-gray-500">₦{(DELIVERY_FEE_PER_SELLER_KOBO.standard / 100).toLocaleString('en-NG')} × {sellerCount} seller{sellerCount > 1 ? 's' : ''}</p>
                  </div>
                  <span class="text-sm font-bold text-gray-900">{formatNaira(deliveryFeeStandard)}</span>
                </label>
                <label class="flex items-center gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="radio" name="delivery_method" value="express" id="delivery-express-radio" />
                  <span class="material-symbols-outlined text-primary">bolt</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-800">Express delivery — 1-2 business days</p>
                    <p class="text-xs text-gray-500">₦{(DELIVERY_FEE_PER_SELLER_KOBO.express / 100).toLocaleString('en-NG')} × {sellerCount} seller{sellerCount > 1 ? 's' : ''}</p>
                  </div>
                  <span class="text-sm font-bold text-gray-900">{formatNaira(deliveryFeeExpress)}</span>
                </label>
              </div>
              <div class="flex gap-2 mt-5">
                <button type="button" class="checkout-back-btn text-gray-600 font-medium px-4 py-2.5 rounded-lg hover:bg-gray-50 transition" data-back-step="1">Back</button>
                <button type="button" class="checkout-next-btn flex-1 bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition" data-next-step="3">
                  Continue to order review
                </button>
              </div>
            </section>

            {/* ============ STEP 3: Order Review + Seller Grouping + Coupon ============ */}
            <section class="checkout-step bg-white border border-gray-200 rounded-xl p-5 hidden" data-step="3">
              <h2 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">receipt_long</span>Review your order
              </h2>

              <div class="space-y-5">
                {sellerGroups.map(([vendorId, group]) => {
                  const groupTotal = group.items.reduce((s, i) => s + i.price_kobo * i.quantity, 0)
                  return (
                    <div class="border border-gray-100 rounded-lg overflow-hidden">
                      <div class="bg-gray-50 px-4 py-2 flex items-center justify-between gap-2">
                        <span class="text-sm font-bold text-gray-800 flex items-center gap-1.5 min-w-0 truncate">
                          <span class="material-symbols-outlined text-primary text-base shrink-0">storefront</span><span class="truncate">{group.vendorName}</span>
                        </span>
                        <span class="text-xs text-gray-500 shrink-0 whitespace-nowrap">Subtotal: {formatNaira(groupTotal)}</span>
                      </div>
                      <div class="divide-y divide-gray-100">
                        {group.items.map((item) => (
                          <div class="flex items-center gap-3 px-4 py-3">
                            <img src={item.image_url} alt={item.title} class="w-12 h-12 rounded-lg object-cover bg-gray-100 shrink-0" />
                            <div class="flex-1 min-w-0">
                              <p class="text-sm text-gray-800 line-clamp-1">{item.title}</p>
                              {item.variant_value && <p class="text-xs text-gray-500">{item.variant_value}</p>}
                              <p class="text-xs text-gray-500">Qty {item.quantity} × {formatNaira(item.price_kobo)}</p>
                            </div>
                            <p class="text-sm font-semibold text-gray-900 shrink-0">{formatNaira(item.price_kobo * item.quantity)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div class="mt-5 border-t border-gray-100 pt-4">
                <label class="block text-sm font-medium text-gray-700 mb-1.5">Have a coupon code?</label>
                <div class="flex gap-2">
                  <input id="coupon-input" placeholder="e.g. WELCOME10" class="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 uppercase" />
                  <button type="button" id="apply-coupon-btn" class="shrink-0 bg-gray-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-900 transition">Apply</button>
                </div>
                <p id="coupon-feedback" class="text-xs mt-1.5"></p>
              </div>

              <div class="flex gap-2 mt-5">
                <button type="button" class="checkout-back-btn text-gray-600 font-medium px-4 py-2.5 rounded-lg hover:bg-gray-50 transition" data-back-step="2">Back</button>
                <button type="button" class="checkout-next-btn flex-1 bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition" data-next-step="4">
                  Continue to payment
                </button>
              </div>
            </section>

            {/* ============ STEP 4: Payment Method + Final Confirmation ============ */}
            <section class="checkout-step bg-white border border-gray-200 rounded-xl p-5 hidden" data-step="4">
              <h2 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">payments</span>Payment method
              </h2>
              <div class="space-y-2">
                <label class="flex items-center gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="radio" name="payment_method" value="wallet" id="payment-wallet-radio" checked={walletBalance >= initialTotal} disabled={walletBalance < initialTotal} />
                  <span class="material-symbols-outlined text-primary">account_balance_wallet</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-800">Pay from NaijaDeals Wallet</p>
                    <p id="wallet-balance-note" class="text-xs text-gray-500">Balance: {formatNaira(walletBalance)}{walletBalance < initialTotal ? ' — insufficient, top up or pay by card' : ''}</p>
                  </div>
                </label>
                <label class="flex items-center gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="radio" name="payment_method" value="paystack" id="payment-paystack-radio" checked={walletBalance < initialTotal} />
                  <span class="material-symbols-outlined text-primary">credit_card</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-800">Pay by card / bank transfer</p>
                    <p class="text-xs text-gray-500">Powered by Paystack — secure hosted checkout</p>
                  </div>
                </label>
              </div>

              <div id="checkout-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mt-4"></div>

              <div class="flex gap-2 mt-5">
                <button type="button" class="checkout-back-btn text-gray-600 font-medium px-4 py-2.5 rounded-lg hover:bg-gray-50 transition" data-back-step="3">Back</button>
                <button type="button" id="place-order-btn" class="flex-1 bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition">
                  Place order — <span id="place-order-total">{formatNaira(initialTotal)}</span>
                </button>
              </div>
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mt-3">
                <span class="material-symbols-outlined text-base">verified_user</span>
                Escrow protected — funds are only released to sellers after you confirm delivery
              </div>
            </section>
          </div>

          {/* ============ Sticky Order Summary sidebar ============ */}
          <div class="bg-white border border-gray-200 rounded-xl p-5 h-fit lg:sticky lg:top-20 min-w-0">
            <h2 class="font-bold text-gray-800 mb-3">Order Summary</h2>
            <div class="space-y-1.5 text-sm">
              <div class="flex justify-between text-gray-600">
                <span>Subtotal ({cartCount} item{cartCount > 1 ? 's' : ''})</span>
                <span id="summary-subtotal">{formatNaira(subtotal)}</span>
              </div>
              <div class="flex justify-between text-gray-600">
                <span>Delivery fee (<span id="summary-seller-count">{sellerCount}</span> seller{sellerCount > 1 ? 's' : ''})</span>
                <span id="summary-delivery-fee">{formatNaira(deliveryFeeStandard)}</span>
              </div>
              <div id="summary-discount-row" class="flex justify-between text-primary hidden">
                <span>Discount</span>
                <span id="summary-discount">-{formatNaira(0)}</span>
              </div>
              <div class="flex justify-between text-base font-bold text-gray-900 pt-2 mt-1.5 border-t border-gray-100">
                <span>Total</span>
                <span id="summary-total">{formatNaira(initialTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        <script id="checkout-init-data" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(initState) }}></script>
      </div>
    </Layout>
  )
}
