/**
 * Seller ownership resolver — THE single source of truth for "is the current
 * authenticated user a seller, and what state is their store in".
 *
 * Resolution chain (never deviate from this):
 *   Authenticated session (c.get('user'), set by attachUser in ../lib/auth.ts)
 *     -> users.id
 *     -> vendors.user_id
 *     -> vendor record
 *
 * SECURITY RULE (non-negotiable): the vendor row is ALWAYS looked up by the
 * authenticated user's id (`WHERE user_id = ?`), never by a vendor_id supplied
 * by the client (query string, form field, JSON body, route param). Every
 * seller-facing page/API must call resolveSellerStatus()/requireActiveSeller()
 * from here — never re-implement "find my vendor row" inline in a route file.
 * This is what makes "Seller A cannot access Seller B's data by guessing a
 * vendor_id" true by construction: the client never gets to name a vendor_id
 * at all on the ownership-resolution path.
 */
import type { Context } from 'hono'
import type { AppEnv, VendorRow } from '../types'

export type SellerState = 'NO_SELLER' | 'ONBOARDING' | 'PENDING_VERIFICATION' | 'REJECTED' | 'SUSPENDED' | 'ACTIVE_SELLER'

export interface SellerResolution {
  state: SellerState
  vendor: VendorRow | null
}

/**
 * Looks up the vendor row owned by the given authenticated user id and
 * classifies it into exactly one of the 6 states defined by the Phase 2 spec.
 * Returns NO_SELLER (vendor: null) if the user has never started onboarding.
 *
 * `userId` MUST come from `c.get('user').id` (a resolved session) — never
 * from any client-controlled input.
 */
export async function resolveSellerStatus(db: D1Database, userId: number): Promise<SellerResolution> {
  const vendor = await db
    .prepare('SELECT * FROM vendors WHERE user_id = ?')
    .bind(userId)
    .first<VendorRow>()

  if (!vendor) {
    return { state: 'NO_SELLER', vendor: null }
  }

  // store_status (seller/admin "pause my store") and verification_status
  // (admin-controlled trust state) are deliberately separate columns — a
  // suspension from EITHER dimension results in the same SUSPENDED gateway
  // state, since either one means the seller cannot operate right now.
  if (vendor.store_status === 'suspended' || vendor.verification_status === 'suspended') {
    return { state: 'SUSPENDED', vendor }
  }
  if (vendor.verification_status === 'rejected') {
    return { state: 'REJECTED', vendor }
  }
  if (!vendor.onboarding_completed_at) {
    return { state: 'ONBOARDING', vendor }
  }
  if (vendor.verification_status === 'pending') {
    return { state: 'PENDING_VERIFICATION', vendor }
  }
  // verification_status === 'verified' AND onboarding_completed_at is set AND store_status is active/paused
  return { state: 'ACTIVE_SELLER', vendor }
}

/** Convenience wrapper for SSR pages that already have `c.get('user')` guaranteed non-null (i.e. mounted behind requireAuthPage). */
export async function resolveSellerStatusForRequest(c: Context<AppEnv>): Promise<SellerResolution> {
  const user = c.get('user')
  if (!user) return { state: 'NO_SELLER', vendor: null }
  return resolveSellerStatus(c.env.DB, user.id)
}

/**
 * Hono middleware for every seller-area route (dashboard/products/orders/finance/...)
 * that requires an ACTIVE_SELLER. Mount AFTER requireAuthPage (so c.get('user') is
 * guaranteed) — e.g.:
 *   app.get('/seller/dashboard', requireAuthPage, requireActiveSeller, sellerDashboardPage)
 *
 * Redirects any non-ACTIVE_SELLER state back to /seller (the gateway), which will
 * route them to the correct state-specific screen. This means:
 *  - a user with NO_SELLER can never reach a seller-area page directly by URL
 *  - a suspended/rejected/onboarding seller is bounced to their own status screen,
 *    never shown another seller's dashboard shell
 * On success, attaches the resolved vendor to c.set('sellerVendor', vendor) so
 * downstream handlers read c.get('sellerVendor').id — NEVER c.req.query('vendor_id')
 * or any other client-supplied value.
 */
export async function requireActiveSeller(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  if (!user) {
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`)
  }
  const { state, vendor } = await resolveSellerStatus(c.env.DB, user.id)
  if (state !== 'ACTIVE_SELLER' || !vendor) {
    return c.redirect('/seller')
  }
  c.set('sellerVendor', vendor)
  await next()
}
