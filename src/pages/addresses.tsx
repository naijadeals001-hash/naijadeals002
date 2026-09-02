import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { getAddressesForUser, getNigerianStates } from '../lib/addresses'

export async function addressesPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')

  const [addresses, states] = await Promise.all([
    getAddressesForUser(db, user.id),
    getNigerianStates(db)
  ])

  return c.render(
    <Layout title="Saved Addresses" user={user} locale={locale}>
      <div class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between mb-2">
          <h1 class="text-xl md:text-2xl font-bold text-gray-800">Saved Addresses</h1>
          <a href="/account" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 shrink-0">
            <span class="material-symbols-outlined text-base">arrow_back</span>Account
          </a>
        </div>
        <p class="text-sm text-gray-500 mb-6">Manage the delivery addresses on your account. Your default address is used automatically at checkout.</p>

        {/* ============ Empty state ============ */}
        <div id="addresses-empty-state" class={`text-center py-16 bg-white border border-gray-200 rounded-xl ${addresses.length > 0 ? 'hidden' : ''}`}>
          <span class="material-symbols-outlined text-5xl text-gray-300">location_off</span>
          <p class="text-gray-700 font-medium mt-3">You don't have any saved addresses yet</p>
          <p class="text-sm text-gray-500 mt-1">Add your first delivery address to speed up checkout.</p>
          <button type="button" id="empty-state-add-btn" class="inline-flex items-center gap-1.5 mt-4 bg-primary text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-primary-dark transition">
            <span class="material-symbols-outlined text-base">add</span>Add your first delivery address
          </button>
        </div>

        {/* ============ Address list ============ */}
        <div id="addresses-list" class={`space-y-3 mb-4 ${addresses.length === 0 ? 'hidden' : ''}`}>
          {addresses.map((addr) => (
                <article
                  class="address-card bg-white border border-gray-200 rounded-xl p-4"
                  data-address-id={addr.id}
                  data-label={addr.label}
                  data-recipient={addr.recipient_name}
                  data-phone={addr.phone}
                  data-line1={addr.line1}
                  data-city={addr.city}
                  data-state={addr.state}
                  data-instructions={addr.delivery_instructions || ''}
                  data-is-default={addr.is_default}
                >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="inline-flex items-center gap-1 text-sm font-bold text-gray-900">
                      <span class="material-symbols-outlined text-base text-primary">
                        {addr.label.toLowerCase() === 'office' || addr.label.toLowerCase() === 'work' ? 'business_center' : addr.label.toLowerCase() === 'home' ? 'home' : 'location_on'}
                      </span>
                      {addr.label}
                    </span>
                    {addr.is_default === 1 && (
                      <span class="address-default-badge text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-semibold shrink-0">DEFAULT</span>
                    )}
                  </div>
                  <p class="text-sm text-gray-800 font-medium mt-1.5">{addr.recipient_name}</p>
                  <p class="text-sm text-gray-600">{addr.phone}</p>
                  <p class="text-sm text-gray-600 mt-0.5">{addr.line1}, {addr.city}, {addr.state}</p>
                  {addr.delivery_instructions && (
                    <p class="text-xs text-gray-500 mt-1.5 flex items-start gap-1">
                      <span class="material-symbols-outlined text-sm shrink-0">info</span>
                      <span>{addr.delivery_instructions}</span>
                    </p>
                  )}
                </div>
              </div>

              <div class="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-sm">
                {addr.is_default === 1 ? (
                  <span class="text-gray-400 font-medium flex items-center gap-1">
                    <span class="material-symbols-outlined text-base">check_circle</span>Default address
                  </span>
                ) : (
                  <button type="button" class="address-set-default-btn text-primary font-semibold hover:underline flex items-center gap-1 py-3 -my-3 min-h-[44px]" data-address-id={addr.id}>
                    <span class="material-symbols-outlined text-base">radio_button_unchecked</span>Set as default
                  </button>
                )}
                <button type="button" class="address-edit-btn text-gray-600 font-medium hover:underline ml-auto flex items-center py-3 -my-3 min-h-[44px]" data-address-id={addr.id}>
                  Edit
                </button>
                <button type="button" class="address-delete-btn text-red-600 font-medium hover:underline flex items-center py-3 -my-3 min-h-[44px]" data-address-id={addr.id} data-address-label={addr.label}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>

        <button type="button" id="show-add-address-btn" class={`inline-flex items-center gap-1.5 text-primary font-semibold hover:underline py-3 -my-1 min-h-[44px] ${addresses.length === 0 ? 'hidden' : ''}`}>
          <span class="material-symbols-outlined text-base">add</span>Add a new address
        </button>

        {/* ============ Add / Edit form (shared, toggled by JS) ============ */}
        <section id="address-form-section" class="hidden bg-white border border-gray-200 rounded-xl p-5 mt-4">
          <h2 id="address-form-title" class="font-bold text-gray-800 mb-4">Add a new address</h2>
          <input type="hidden" id="af-address-id" value="" />
          <div class="grid sm:grid-cols-2 gap-3">
            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-gray-700 mb-1" for="af-label">Address label</label>
              <select id="af-label" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                <option value="Home">Home</option>
                <option value="Office">Office</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="af-recipient">Recipient name</label>
              <input id="af-recipient" placeholder="Full name" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="af-phone">Phone number</label>
              <input id="af-phone" type="tel" placeholder="080XXXXXXXX" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-gray-700 mb-1" for="af-line1">Street address</label>
              <input id="af-line1" placeholder="House number and street name" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="af-city">City</label>
              <input id="af-city" placeholder="e.g. Ikeja" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="af-state">State</label>
              <select id="af-state" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                <option value="">Select a state</option>
                {states.map((s) => (
                  <option value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-gray-700 mb-1" for="af-instructions">Delivery instructions <span class="text-gray-400 font-normal">(optional)</span></label>
              <textarea id="af-instructions" rows={2} placeholder="e.g. Gate code, landmark, preferred delivery time" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 resize-none"></textarea>
            </div>
            <div class="sm:col-span-2 flex items-center gap-2">
              <input id="af-default" type="checkbox" class="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30" />
              <label for="af-default" class="text-sm text-gray-700">Set as default address</label>
            </div>
            <div id="address-form-error" class="hidden sm:col-span-2 text-red-600 text-xs"></div>
            <div class="sm:col-span-2 flex gap-2 mt-1">
              <button type="button" id="save-address-btn" class="bg-primary text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-primary-dark transition">Save address</button>
              <button type="button" id="cancel-address-btn" class="text-gray-500 text-sm font-medium px-4 py-2.5 hover:bg-gray-50 rounded-lg transition">Cancel</button>
            </div>
          </div>
        </section>

        {/* ============ Delete confirmation (inline, non-modal — avoids any mobile overflow/drawer risk) ============ */}
        <div id="delete-confirm-overlay" class="hidden fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div class="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5">
            <h3 class="font-bold text-gray-800">Delete this address?</h3>
            <p id="delete-confirm-text" class="text-sm text-gray-600 mt-1.5">This will permanently remove this saved address from your account.</p>
            <div class="flex gap-2 mt-5">
              <button type="button" id="delete-confirm-cancel-btn" class="flex-1 text-gray-600 font-medium py-2.5 rounded-lg hover:bg-gray-50 border border-gray-200 transition">Cancel</button>
              <button type="button" id="delete-confirm-btn" class="flex-1 bg-red-600 text-white font-semibold py-2.5 rounded-lg hover:bg-red-700 transition">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
