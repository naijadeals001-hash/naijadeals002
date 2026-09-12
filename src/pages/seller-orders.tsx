import type { Context } from 'hono'
import { SellerLayout } from '../components/SellerLayout'
import type { AppEnv } from '../types'
import { getOrdersForVendor } from '../lib/seller-products'

/**
 * REAL seller Orders page (Marketplace Engine 2.0) — replaces the fake
 * ComingSoonPanel. Lists every order containing at least one item sold by
 * this vendor (scoped strictly by vendor_id, never another seller's rows
 * even within a shared multi-vendor order — see getOrdersForVendor's doc
 * comment in src/lib/seller-products.ts).
 */
export async function sellerOrdersPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const vendor = c.get('sellerVendor')!
  const locale = c.get('locale')
  const orders = await getOrdersForVendor(c.env.DB, vendor.id, { limit: 100 })

  return c.render(
    <SellerLayout title="Orders" user={user} vendor={vendor} active="orders" locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-8">
        <h1 class="text-xl font-bold text-gray-900 mb-6">Your Orders</h1>
        <div id="seller-orders-error" class="hidden bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 mb-4"></div>
        <div class="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {(orders as any[]).length === 0 ? (
            <div class="p-10 text-center text-gray-500 text-sm">No orders yet. Orders containing your products will appear here.</div>
          ) : (
            (orders as any[]).map((o) => (
              <div class="p-4" data-order-id={o.id}>
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-semibold text-gray-900 text-sm">{o.order_number}</div>
                    <div class="text-xs text-gray-500 mt-0.5">{o.shipping_city}, {o.shipping_state} · {new Date(o.created_at).toLocaleDateString()}</div>
                  </div>
                  <span class="text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">{o.status}</span>
                </div>
                <button class="load-order-items-btn text-primary text-xs font-semibold hover:underline mt-2" data-order-id={o.id}>
                  View my items in this order
                </button>
                <div class="order-items-panel hidden mt-3 border-t border-gray-100 pt-3 space-y-2" data-order-id={o.id}></div>
              </div>
            ))
          )}
        </div>
      </div>
      <script src="/static/seller.js"></script>
    </SellerLayout>
  )
}
