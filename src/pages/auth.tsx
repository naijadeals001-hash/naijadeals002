import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'

/**
 * Phase B — Customer vs Seller signup fork.
 *
 * IMPORTANT: this is a presentation/routing-layer feature only. It does NOT
 * change the users table, does NOT set users.role, and does NOT touch
 * Migration 0009 / vendors in any way. A "seller" only ever becomes real once
 * a row exists in `vendors` with user_id = this user (see src/lib/seller.ts,
 * resolveSellerStatus). All this page does is:
 *   1. Show clearly distinct "Customer Account" / "Seller Account" copy+CTAs.
 *   2. Default the post-registration redirect (`next`) to /seller when the
 *      visitor picked the seller path, so they land straight on the existing
 *      /seller gateway, which already renders the NO_SELLER -> onboarding
 *      invite state correctly (src/pages/seller.tsx). That's the ENTIRE
 *      mechanism — no new backend logic required.
 *
 * The same account-creation endpoint (/api/auth/register) is used either way.
 * A user who starts as "customer" can always become a seller later via the
 * existing /seller -> onboarding flow, and vice versa — one identity, two
 * capabilities, exactly as required.
 */
function isSellerIntent(c: Context<AppEnv>): boolean {
  return c.req.query('intent') === 'seller'
}

export async function loginPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')
  const next = c.req.query('next') || '/'
  const isSellerFlow = next === '/seller' || next.startsWith('/seller/')

  if (user) {
    return c.redirect(next)
  }

  const registerHref = isSellerFlow
    ? `/register?intent=seller&next=${encodeURIComponent(next)}`
    : `/register?next=${encodeURIComponent(next)}`

  return c.render(
    <Layout title="Sign in" user={user} locale={locale}>
      <div class="max-w-md mx-auto px-6 py-12">
        <h1 class="text-2xl font-bold text-gray-800 mb-1">Sign in</h1>
        <p class="text-sm text-gray-500 mb-6">
          {isSellerFlow
            ? 'Sign in to manage your NaijaDeals store.'
            : 'One account for shopping, food, gigs and stays across Nigeria.'}
        </p>

        <div id="auth-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4"></div>

        <form id="login-form" class="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email or phone number</label>
            <input name="identifier" required placeholder="you@example.com or 080XXXXXXXX" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <button type="submit" class="w-full bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition">
            Sign in
          </button>
        </form>

        <p class="text-sm text-gray-500 mt-6 text-center">
          {isSellerFlow ? (
            <>New to selling on NaijaDeals? <a href={registerHref} class="text-primary font-semibold hover:underline">Create a Seller Account</a></>
          ) : (
            <>New to NaijaDeals? <a href={registerHref} class="text-primary font-semibold hover:underline">Create an account</a></>
          )}
        </p>
      </div>
    </Layout>
  )
}

export async function registerPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')
  const isSeller = isSellerIntent(c)
  const next = c.req.query('next') || (isSeller ? '/seller' : '/')

  if (user) {
    return c.redirect(next)
  }

  // Preserve whichever side of the fork is inactive so the toggle round-trips
  // the visitor's original destination instead of always resetting it. Only
  // reset when the current `next` is itself seller-specific (e.g. /seller),
  // since that destination wouldn't make sense for a customer signup.
  const nextIsSellerSpecific = next === '/seller' || next.startsWith('/seller/')
  const customerHref = `/register?next=${encodeURIComponent(isSeller && nextIsSellerSpecific ? '/' : next)}`
  const sellerHref = `/register?intent=seller&next=${encodeURIComponent(!isSeller && next === '/' ? '/seller' : next)}`

  return c.render(
    <Layout title={isSeller ? 'Create a Seller Account' : 'Create a Customer Account'} user={user} locale={locale}>
      <div class="max-w-md mx-auto px-6 py-12">
        {/* Phase B: Customer vs Seller signup fork */}
        <div id="signup-intent-toggle" class="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6" role="tablist" aria-label="Account type">
          <a
            href={customerHref}
            role="tab"
            aria-selected={!isSeller ? 'true' : 'false'}
            class={`flex-1 text-center text-sm font-semibold py-2 rounded-md transition-colors ${
              !isSeller ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Customer Account
          </a>
          <a
            href={sellerHref}
            role="tab"
            aria-selected={isSeller ? 'true' : 'false'}
            class={`flex-1 text-center text-sm font-semibold py-2 rounded-md transition-colors ${
              isSeller ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Seller Account
          </a>
        </div>

        {isSeller ? (
          <>
            <h1 class="text-2xl font-bold text-gray-800 mb-1">Sell on NaijaDeals — Create a Seller Account</h1>
            <p class="text-sm text-gray-500 mb-6">Open your store, list products and start receiving orders from shoppers across Nigeria.</p>
          </>
        ) : (
          <>
            <h1 class="text-2xl font-bold text-gray-800 mb-1">Create a Customer Account</h1>
            <p class="text-sm text-gray-500 mb-6">Shop, order food, book services and stays — all with one NaijaDeals account.</p>
          </>
        )}

        <div id="auth-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4"></div>

        <form id="register-form" class="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Full name</label>
            <input name="name" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" name="email" placeholder="you@example.com" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Phone number</label>
            <input name="phone" placeholder="080XXXXXXXX" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <p class="text-xs text-gray-400">Provide at least an email or a phone number.</p>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" name="password" required minlength="8" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <p class="text-xs text-gray-400 mt-1">At least 8 characters.</p>
          </div>
          <button type="submit" class="w-full bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition">
            {isSeller ? 'Create seller account' : 'Create account'}
          </button>
        </form>

        {isSeller && (
          <p class="text-xs text-gray-400 mt-4 text-center">
            After creating your account, you'll set up your store — business details, verification and payout account.
          </p>
        )}

        <p class="text-sm text-gray-500 mt-6 text-center">
          Already have an account? <a href={`/login?next=${encodeURIComponent(next)}`} class="text-primary font-semibold hover:underline">Sign in</a>
        </p>
      </div>
    </Layout>
  )
}
