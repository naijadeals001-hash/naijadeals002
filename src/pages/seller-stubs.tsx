import type { Context } from 'hono'
import { SellerLayout } from '../components/SellerLayout'
import type { AppEnv } from '../types'

/**
 * Minimal, ownership-gated Seller Center destinations for Phase 2.
 *
 * WHY THESE EXIST AT ALL: Phase 2's own security-test requirements name
 * /seller/dashboard, /seller/products, /seller/orders, /seller/finance as
 * routes a NO_SELLER user must be explicitly blocked from. A route that
 * doesn't exist 404s identically for everyone regardless of authorization,
 * which would make that test meaningless. So each of these exists as a real,
 * requireActiveSeller-gated page reflecting the seller's ACTUAL resolved
 * vendor row (real store name, real verification/store status) — nothing
 * fabricated — while being honest that the full feature (product CRUD, order
 * management, payout creation) is "Coming soon" and belongs to Phase 3+.
 *
 * These pages are mounted in src/index.tsx behind:
 *   app.get('/seller/dashboard', requireAuthPage, requireActiveSeller, sellerDashboardPage)
 * requireActiveSeller (src/lib/seller.ts) is what makes them safe: it resolves
 * the vendor server-side from the session and attaches it as c.get('sellerVendor')
 * — a NO_SELLER, ONBOARDING, PENDING_VERIFICATION, REJECTED or SUSPENDED user is
 * redirected to /seller (never shown this shell), and no vendor_id is ever read
 * from the client on this path.
 */

function ComingSoonPanel({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 py-14 text-center">
      <span class="material-symbols-outlined text-4xl text-primary bg-primary-light w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5">
        {icon}
      </span>
      <h1 class="text-xl md:text-2xl font-bold text-gray-900">{title}</h1>
      <p class="text-gray-500 mt-3 text-sm max-w-md mx-auto">{desc}</p>
      <span class="inline-flex items-center gap-1.5 text-xs font-semibold bg-gray-100 text-gray-500 rounded-full px-3 py-1.5 mt-6">
        <span class="material-symbols-outlined text-sm">schedule</span>
        Coming soon
      </span>
    </div>
  )
}

export async function sellerDashboardPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const vendor = c.get('sellerVendor')!

  return c.render(
    <SellerLayout title="Overview" user={user} vendor={vendor} active="overview">
      <div class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 py-10">
        <div class="bg-white border border-gray-200 rounded-xl p-6 md:p-8 text-center">
          <span class="material-symbols-outlined text-4xl text-primary bg-primary-light w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5">
            storefront
          </span>
          <h1 class="text-xl md:text-2xl font-bold text-gray-900">Welcome, {vendor.business_name || vendor.name}</h1>
          <p class="text-gray-500 mt-2 text-sm">
            Your store is verified and active on NaijaDeals. Full dashboard analytics, product management, order management and payouts are arriving in upcoming releases.
          </p>
          <span class="inline-flex items-center gap-1.5 text-xs font-semibold bg-gray-100 text-gray-500 rounded-full px-3 py-1.5 mt-5">
            <span class="material-symbols-outlined text-sm">schedule</span>
            Full dashboard — coming soon
          </span>
        </div>
      </div>
    </SellerLayout>
  )
}

export async function sellerProductsPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const vendor = c.get('sellerVendor')!
  return c.render(
    <SellerLayout title="Products" user={user} vendor={vendor} active="products">
      <ComingSoonPanel
        icon="inventory_2"
        title="Product management is on its way"
        desc="Soon you'll be able to list, edit and manage stock for your products right here. We'll notify you the moment this is ready."
      />
    </SellerLayout>
  )
}

export async function sellerOrdersPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const vendor = c.get('sellerVendor')!
  return c.render(
    <SellerLayout title="Orders" user={user} vendor={vendor} active="orders">
      <ComingSoonPanel
        icon="receipt_long"
        title="Order management is on its way"
        desc="Soon you'll see every order for your store here in real time, with fulfilment status updates. We'll notify you the moment this is ready."
      />
    </SellerLayout>
  )
}

export async function sellerFinancePage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const vendor = c.get('sellerVendor')!
  return c.render(
    <SellerLayout title="Finance" user={user} vendor={vendor} active="finance">
      <ComingSoonPanel
        icon="payments"
        title="Seller Finance is on its way"
        desc="Soon you'll be able to track your earnings and receive payouts to a Nigerian bank account right here. Earnings only ever reflect real, escrow-released sales — never estimates."
      />
    </SellerLayout>
  )
}
