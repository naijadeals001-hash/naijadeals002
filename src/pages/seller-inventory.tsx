import type { Context } from 'hono'
import { SellerLayout } from '../components/SellerLayout'
import type { AppEnv } from '../types'
import { getListingsForVendor } from '../lib/seller-products'
import { computeAvailableQuantity, isLowStock } from '../lib/inventory'

/**
 * REAL seller Inventory page (Marketplace Engine 2.0, spec section 9) —
 * a NEW seller-area page (not one of the previously-fake stubs) exposing
 * stock/reserved/available/low-stock and manual adjustment for every
 * listing this vendor owns.
 */
export async function sellerInventoryPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const vendor = c.get('sellerVendor')!
  const locale = c.get('locale')
  const listings = (await getListingsForVendor(c.env.DB, vendor.id, { limit: 200 })) as any[]

  return c.render(
    <SellerLayout title="Inventory" user={user} vendor={vendor} active="inventory" locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-8">
        <h1 class="text-xl font-bold text-gray-900 mb-6">Inventory</h1>
        <div id="seller-inventory-error" class="hidden bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 mb-4"></div>
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th class="text-left px-4 py-2">Product</th>
                <th class="text-right px-4 py-2">Stock</th>
                <th class="text-right px-4 py-2">Reserved</th>
                <th class="text-right px-4 py-2">Available</th>
                <th class="text-center px-4 py-2">Status</th>
                <th class="text-right px-4 py-2">Adjust</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {listings.map((l) => {
                const available = computeAvailableQuantity(l)
                const low = isLowStock(l)
                return (
                  <tr data-listing-id={l.id}>
                    <td class="px-4 py-2 font-medium text-gray-900">{l.product_title}</td>
                    <td class="px-4 py-2 text-right stock-cell">{l.stock}</td>
                    <td class="px-4 py-2 text-right">{l.reserved_quantity ?? 0}</td>
                    <td class="px-4 py-2 text-right available-cell">{available}</td>
                    <td class="px-4 py-2 text-center">
                      <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${low ? 'bg-amber-50 text-amber-700' : 'bg-primary-light text-primary-dark'}`}>
                        {low ? 'Low stock' : 'OK'}
                      </span>
                    </td>
                    <td class="px-4 py-2 text-right">
                      <div class="flex items-center justify-end gap-1">
                        <input type="number" class="adjust-input w-16 border border-gray-300 rounded px-2 py-1 text-xs" placeholder="±qty" />
                        <button class="adjust-btn text-primary text-xs font-semibold hover:underline" data-listing-id={l.id}>Apply</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {listings.length === 0 && <div class="p-10 text-center text-gray-500 text-sm">No listings yet.</div>}
        </div>
      </div>
      <script src="/static/seller.js"></script>
    </SellerLayout>
  )
}
