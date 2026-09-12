import type { Context } from 'hono'
import { SellerLayout } from '../components/SellerLayout'
import type { AppEnv } from '../types'
import { getTopLevelCategories, getSubcategories } from '../lib/catalog'
import { getListingsForVendor } from '../lib/seller-products'
import { formatNaira } from '../lib/money'

/**
 * REAL seller Products page (Marketplace Engine 2.0, spec sections 27/28/47)
 * — replaces the fake ComingSoonPanel that previously rendered here. Lists
 * every listing owned by the resolved seller vendor (server-rendered, real
 * data from product_listings JOIN products) and provides a working
 * "Create Product & Listing" form that posts to /api/seller/products and
 * /api/seller/listings.
 */
export async function sellerProductsPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const vendor = c.get('sellerVendor')!
  const locale = c.get('locale')
  const db = c.env.DB

  const listings = await getListingsForVendor(db, vendor.id, { limit: 100 })
  const categories = await getTopLevelCategories(db)

  return c.render(
    <SellerLayout title="Products" user={user} vendor={vendor} active="products" locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-8">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-xl font-bold text-gray-900">Your Products</h1>
          <button id="open-create-product" class="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors">
            + New Product &amp; Listing
          </button>
        </div>

        <div id="seller-products-error" class="hidden bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 mb-4"></div>

        <div id="seller-products-list" class="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {(listings as any[]).length === 0 ? (
            <div class="p-10 text-center text-gray-500 text-sm">
              You have no products yet. Click "New Product &amp; Listing" to create your first one.
            </div>
          ) : (
            (listings as any[]).map((l) => (
              <div class="flex items-center gap-4 p-4" data-listing-id={l.id}>
                <img src={l.product_image_url} alt={l.product_title} class="w-14 h-14 rounded-lg object-cover border border-gray-100" />
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-gray-900 text-sm truncate">{l.product_title}</div>
                  <div class="text-xs text-gray-500 mt-0.5">{l.category_name} · SKU: {l.sku || '—'} · {l.unit_of_measure}</div>
                </div>
                <div class="text-sm font-semibold text-gray-900 w-24 text-right">{formatNaira(l.price_kobo)}</div>
                <div class="text-xs w-20 text-right">
                  <span class={`px-2 py-0.5 rounded-full font-semibold ${l.stock > (l.low_stock_threshold ?? 5) ? 'bg-primary-light text-primary-dark' : 'bg-amber-50 text-amber-700'}`}>
                    {l.stock} in stock
                  </span>
                </div>
                <div class="text-xs w-28 text-right">
                  <span class={`px-2 py-0.5 rounded-full font-semibold ${
                    l.moderation_status === 'active' ? 'bg-primary-light text-primary-dark' :
                    l.moderation_status === 'pending_review' ? 'bg-amber-50 text-amber-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {l.moderation_status}
                  </span>
                </div>
                <button class="edit-listing-btn text-primary text-xs font-semibold hover:underline" data-listing-id={l.id}>Edit</button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ---------- Create Product & Listing modal ---------- */}
      <div id="create-product-modal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
          <h2 class="text-lg font-bold text-gray-900 mb-4">New Product &amp; Listing</h2>
          <form id="create-product-form" class="space-y-3">
            <div>
              <label class="text-xs font-semibold text-gray-600">Product Title</label>
              <input name="title" required class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" placeholder="e.g. 25kg Nigerian Rice" />
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-600">Category</label>
              <select name="category_id" required class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1">
                <option value="">Select category</option>
                {(categories as any[]).map((cat) => <option value={cat.id}>{cat.name}</option>)}
              </select>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-600">Image URL</label>
              <input name="image_url" required class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" placeholder="https://..." />
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-600">Description</label>
              <textarea name="description" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" rows={2}></textarea>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-semibold text-gray-600">Price (₦)</label>
                <input name="price_naira" type="number" min="1" required class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label class="text-xs font-semibold text-gray-600">Stock Quantity</label>
                <input name="stock" type="number" min="0" required class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-semibold text-gray-600">Unit of Measure</label>
                <select name="unit_of_measure" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1">
                  <option value="piece">piece</option>
                  <option value="pack">pack</option>
                  <option value="box">box</option>
                  <option value="kg">kg</option>
                  <option value="gram">gram</option>
                  <option value="ton">ton</option>
                  <option value="liter">liter</option>
                  <option value="ml">ml</option>
                  <option value="bundle">bundle</option>
                  <option value="dozen">dozen</option>
                  <option value="crate">crate</option>
                  <option value="bag">bag</option>
                  <option value="bottle">bottle</option>
                </select>
              </div>
              <div>
                <label class="text-xs font-semibold text-gray-600">Unit Quantity</label>
                <input name="unit_quantity" type="number" min="0.01" step="0.01" value="1" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
            </div>
            <label class="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" name="is_variable_weight" /> This product is sold by variable weight (e.g. fresh fish/produce)
            </label>
            <div class="border-t border-gray-100 pt-3">
              <label class="text-xs font-semibold text-gray-600 flex items-center justify-between">
                <span>Bulk / Wholesale Pricing (optional)</span>
                <button type="button" id="add-tier-row" class="text-primary font-semibold">+ Add tier</button>
              </label>
              <div id="pricing-tiers-rows" class="space-y-2 mt-2"></div>
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <button type="button" id="cancel-create-product" class="px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
              <button type="submit" class="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark">Create</button>
            </div>
          </form>
        </div>
      </div>

      <script src="/static/seller.js"></script>
    </SellerLayout>
  )
}
