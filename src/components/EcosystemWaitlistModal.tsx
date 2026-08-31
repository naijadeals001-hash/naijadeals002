import type { FC } from 'hono/jsx'

/**
 * EcosystemWaitlistModal — the real, functional waitlist experience required
 * by Pat's fix-task ("Join the waitlist" must actually work, not link to
 * #footer). One reusable component + one shared JS module
 * (public/static/app.js's initEcosystemWaitlistModal) power every "Join the
 * waitlist" CTA across all 8 vertical preview pages AND /ecosystem.
 *
 * Rendering contract: mount this ONCE per page (it renders a single hidden
 * overlay with a fixed id, `ecosystem-waitlist-modal`) alongside as many
 * trigger buttons/links as the page wants — any element with
 * `data-open-waitlist-modal` (optionally with `data-preselect-service="eats"`
 * etc.) opens it via a click listener registered in app.js. This mirrors the
 * existing inline delete-confirm overlay pattern in addresses.tsx.
 *
 * Responsive contract (Pat's requirement 1):
 *   - Desktop (>=768px, Tailwind `sm:`/`md:` breakpoints): centered modal,
 *     max-width card, vertical scroll inside the card if content overflows
 *     viewport height.
 *   - Mobile (<768px): bottom-sheet — full-width, anchored to the bottom,
 *     rounded top corners, own internal scroll — never causes page-level
 *     horizontal overflow because the overlay itself is `fixed inset-0`.
 *   - Every tappable control (checkboxes, inputs, buttons) is at least 44px
 *     tall via explicit `min-h-[44px]` / py-3+ sizing below.
 *
 * Accessibility contract (Pat's requirement 16 — keyboard accessibility):
 *   - `role="dialog"` `aria-modal="true"` `aria-labelledby` on the panel.
 *   - Every input has a real, associated <label>.
 *   - Escape-to-close and click-outside-to-close are wired in app.js.
 *   - Focus is moved into the modal on open and returned to the trigger on
 *     close (app.js) — a basic but real focus-trap-adjacent behaviour rather
 *     than leaving focus stranded on a hidden element.
 */
export const EcosystemWaitlistModal: FC = () => {
  return (
    <div
      id="ecosystem-waitlist-modal"
      class="hidden fixed inset-0 z-50 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ewm-title"
    >
      <div class="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
        <div class="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
          {/* ---- Close button ---- */}
          <button
            type="button"
            id="ewm-close-btn"
            aria-label="Close waitlist form"
            class="absolute top-3 right-3 sm:top-4 sm:right-4 w-11 h-11 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition z-10"
          >
            <span class="material-symbols-outlined text-2xl">close</span>
          </button>

          {/* ---- Mobile drag-handle affordance ---- */}
          <div class="sm:hidden flex justify-center pt-3">
            <span class="w-10 h-1.5 rounded-full bg-gray-200"></span>
          </div>

          {/* ============ FORM STATE ============ */}
          <div id="ewm-form-state" class="p-6 sm:p-8">
            <div class="flex items-center gap-3 mb-1">
              <span class="material-symbols-outlined text-3xl text-primary w-12 h-12 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
                notifications_active
              </span>
              <div>
                <h2 id="ewm-title" class="text-lg sm:text-xl font-bold text-gray-900">Join the NaijaDeals waitlist</h2>
                <p class="text-xs sm:text-sm text-gray-500">Be first to know when your selected services launch in your city.</p>
              </div>
            </div>

            <form id="ewm-form" class="mt-6 space-y-4" novalidate>
              <div id="ewm-form-error" class="hidden bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3.5 py-2.5"></div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="ewm-full-name" class="block text-xs font-semibold text-gray-700 mb-1">Full name</label>
                  <input
                    id="ewm-full-name"
                    name="fullName"
                    type="text"
                    required
                    autocomplete="name"
                    placeholder="Chinedu Okafor"
                    class="w-full min-h-[44px] px-3.5 py-2.5 text-sm text-gray-800 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label for="ewm-email" class="block text-xs font-semibold text-gray-700 mb-1">Email address</label>
                  <input
                    id="ewm-email"
                    name="email"
                    type="email"
                    required
                    autocomplete="email"
                    placeholder="you@example.com"
                    class="w-full min-h-[44px] px-3.5 py-2.5 text-sm text-gray-800 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="ewm-phone" class="block text-xs font-semibold text-gray-700 mb-1">Phone number</label>
                  <input
                    id="ewm-phone"
                    name="phone"
                    type="tel"
                    required
                    autocomplete="tel"
                    placeholder="0803 123 4567"
                    class="w-full min-h-[44px] px-3.5 py-2.5 text-sm text-gray-800 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label for="ewm-city" class="block text-xs font-semibold text-gray-700 mb-1">City</label>
                  <input
                    id="ewm-city"
                    name="city"
                    type="text"
                    required
                    autocomplete="address-level2"
                    placeholder="Lagos"
                    class="w-full min-h-[44px] px-3.5 py-2.5 text-sm text-gray-800 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label for="ewm-state" class="block text-xs font-semibold text-gray-700 mb-1">State</label>
                <select
                  id="ewm-state"
                  name="state"
                  required
                  class="w-full min-h-[44px] px-3.5 py-2.5 text-sm text-gray-800 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
                >
                  <option value="">Select your state</option>
                </select>
              </div>

              {/* ---- Service selection — clear cards/chips, not a bare checklist ---- */}
              <fieldset>
                <legend class="text-xs font-semibold text-gray-700 mb-2">Which services do you want to hear about? <span class="text-gray-400 font-normal">(select at least one)</span></legend>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label class="ewm-service-card flex items-center gap-2.5 min-h-[44px] px-3.5 py-2.5 border border-gray-300 rounded-lg cursor-pointer hover:border-primary/50 transition has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                    <input type="checkbox" name="naijaEats" id="ewm-svc-eats" class="w-4.5 h-4.5 accent-primary" />
                    <span class="material-symbols-outlined text-lg text-amber-600">restaurant</span>
                    <span class="text-sm font-medium text-gray-800">NaijaEats</span>
                  </label>
                  <label class="ewm-service-card flex items-center gap-2.5 min-h-[44px] px-3.5 py-2.5 border border-gray-300 rounded-lg cursor-pointer hover:border-primary/50 transition has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                    <input type="checkbox" name="naijaGigs" id="ewm-svc-gigs" class="w-4.5 h-4.5 accent-primary" />
                    <span class="material-symbols-outlined text-lg text-blue-600">design_services</span>
                    <span class="text-sm font-medium text-gray-800">NaijaGigs</span>
                  </label>
                  <label class="ewm-service-card flex items-center gap-2.5 min-h-[44px] px-3.5 py-2.5 border border-gray-300 rounded-lg cursor-pointer hover:border-primary/50 transition has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                    <input type="checkbox" name="naijaStay" id="ewm-svc-stay" class="w-4.5 h-4.5 accent-primary" />
                    <span class="material-symbols-outlined text-lg text-purple-600">bed</span>
                    <span class="text-sm font-medium text-gray-800">NaijaStay</span>
                  </label>
                </div>
                <label class="ewm-service-card flex items-center gap-2.5 min-h-[44px] px-3.5 py-2.5 mt-2 border border-gray-300 rounded-lg cursor-pointer hover:border-primary/50 transition has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="checkbox" name="allServices" id="ewm-svc-all" class="w-4.5 h-4.5 accent-primary" />
                  <span class="material-symbols-outlined text-lg text-primary">workspace_premium</span>
                  <span class="text-sm font-medium text-gray-800">Notify me about all upcoming NaijaDeals services</span>
                </label>
                <p id="ewm-service-error" class="hidden text-xs text-red-600 mt-1.5">Please select at least one service.</p>
              </fieldset>

              <button
                type="submit"
                id="ewm-submit-btn"
                class="w-full min-h-[48px] bg-primary hover:bg-primary-dark text-white font-semibold py-3 rounded-lg transition flex items-center justify-center gap-2"
              >
                <span class="material-symbols-outlined text-lg">how_to_reg</span>
                Join the waitlist
              </button>
              <p class="text-[11px] text-gray-400 text-center">No spam — we'll only email you about the services you selected above.</p>
            </form>
          </div>

          {/* ============ SUCCESS STATE ============ */}
          <div id="ewm-success-state" class="hidden p-6 sm:p-8 text-center">
            <span class="material-symbols-outlined text-4xl text-white w-16 h-16 rounded-full bg-primary flex items-center justify-center mx-auto mb-4">
              check
            </span>
            <h2 class="text-lg sm:text-xl font-bold text-gray-900">You're on the list!</h2>
            <p class="text-sm text-gray-500 mt-2">We'll let you know when your selected NaijaDeals services launch in your city.</p>
            <div id="ewm-success-services" class="flex flex-wrap justify-center gap-2 mt-4"></div>
            <button
              type="button"
              id="ewm-success-close-btn"
              class="mt-7 w-full min-h-[44px] bg-primary-light text-primary-dark font-semibold py-2.5 rounded-lg hover:bg-primary/20 transition"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
