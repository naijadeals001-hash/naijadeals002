import type { Context } from 'hono'
import { SellerLayout } from '../components/SellerLayout'
import type { AppEnv } from '../types'
import { formatNaira } from '../lib/money'

/**
 * REAL seller Dashboard overview (Marketplace Engine 2.0) — replaces the
 * fake "Coming soon" welcome panel with actual counts pulled live from
 * product_listings/orders/order_items, scoped strictly to this vendor.
 */
export async function sellerDashboardPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const vendor = c.get('sellerVendor')!
  const locale = c.get('locale')
  const db = c.env.DB

  const [productCount, activeListingCount, lowStockCount, orderCount, pendingReviewCount] = await Promise.all([
    db.prepare('SELECT COUNT(DISTINCT product_id) AS n FROM product_listings WHERE vendor_id = ?').bind(vendor.id).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM product_listings WHERE vendor_id = ? AND is_active = 1 AND moderation_status = 'active'`).bind(vendor.id).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM product_listings WHERE vendor_id = ? AND (stock - reserved_quantity) <= low_stock_threshold').bind(vendor.id).first<{ n: number }>(),
    db.prepare('SELECT COUNT(DISTINCT order_id) AS n FROM order_items WHERE vendor_id = ?').bind(vendor.id).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM product_listings WHERE vendor_id = ? AND moderation_status = 'pending_review'`).bind(vendor.id).first<{ n: number }>(),
  ])

  const revenueRow = await db
    .prepare(
      `SELECT COALESCE(SUM(oi.line_total_kobo), 0) AS total
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.vendor_id = ? AND o.payment_status != 'unpaid'`
    )
    .bind(vendor.id)
    .first<{ total: number }>()

  const stats = [
    { label: 'Products Listed', value: productCount?.n ?? 0, icon: 'inventory_2' },
    { label: 'Active Listings', value: activeListingCount?.n ?? 0, icon: 'storefront' },
    { label: 'Pending Review', value: pendingReviewCount?.n ?? 0, icon: 'pending' },
    { label: 'Low Stock Alerts', value: lowStockCount?.n ?? 0, icon: 'warning' },
    { label: 'Total Orders', value: orderCount?.n ?? 0, icon: 'receipt_long' },
    { label: 'Total Revenue', value: formatNaira(revenueRow?.total ?? 0), icon: 'payments' },
  ]

  return c.render(
    <SellerLayout title="Overview" user={user} vendor={vendor} active="overview" locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-8">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-xl font-bold text-gray-900">Welcome, {vendor.business_name || vendor.name}</h1>
          <a href="/seller/products" class="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors">
            Manage Products
          </a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
          {stats.map((s) => (
            <div class="bg-white border border-gray-200 rounded-xl p-4">
              <span class="material-symbols-outlined text-primary text-xl">{s.icon}</span>
              <div class="text-2xl font-bold text-gray-900 mt-2">{s.value}</div>
              <div class="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
          <a href="/seller/products" class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 hover:border-primary transition-colors">
            <span class="material-symbols-outlined text-primary">inventory_2</span>
            <span class="text-sm font-semibold text-gray-800">Products &amp; Listings</span>
          </a>
          <a href="/seller/inventory" class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 hover:border-primary transition-colors">
            <span class="material-symbols-outlined text-primary">warehouse</span>
            <span class="text-sm font-semibold text-gray-800">Inventory</span>
          </a>
          <a href="/seller/orders" class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 hover:border-primary transition-colors">
            <span class="material-symbols-outlined text-primary">receipt_long</span>
            <span class="text-sm font-semibold text-gray-800">Orders</span>
          </a>
        </div>
      </div>
    </SellerLayout>
  )
}
