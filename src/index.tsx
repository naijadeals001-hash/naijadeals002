import { Hono } from 'hono'
import { renderer } from './renderer'
import { serveStatic } from 'hono/cloudflare-workers'
import type { AppEnv } from './types'
import { attachUser, attachLocale, requireAuthPage } from './lib/auth'
import { requireActiveSeller } from './lib/seller'
import { affiliateClickMiddleware } from './lib/affiliate'

// API sub-apps
import { catalogApi } from './routes/api-catalog'
import { cartApi } from './routes/api-cart'
import { authApi } from './routes/api-auth'
import { ordersApi } from './routes/api-orders'
import { addressesApi } from './routes/api-addresses'
import { walletApi } from './routes/api-wallet'
import { affiliateApi } from './routes/api-affiliate'
import { accountApi } from './routes/api-account'
import { organizationsApi } from './routes/api-organizations'
import { webhooksApi } from './routes/api-webhooks'
import { wishlistApi } from './routes/api-wishlist'
import { ecosystemApi } from './routes/api-ecosystem'
import { placeholderRoute } from './routes/placeholder'
import { versionRoute } from './routes/version'
import { i18nApi } from './routes/api-i18n'
import { sellerApi } from './routes/api-seller'
import { servicesApi } from './routes/api-services'
import { serviceRequestsApi } from './routes/api-service-requests'
import { providerApi } from './routes/api-provider'

// SSR pages
import { homePage } from './pages/home'
import { shopPage } from './pages/shop'
import { productPage } from './pages/product'
import { cartPage } from './pages/cart'
import { checkoutPage, checkoutCallbackPage } from './pages/checkout'
import { loginPage, registerPage } from './pages/auth'
import { ordersListPage, orderDetailPage } from './pages/orders'
import { walletPage } from './pages/wallet'
import { wishlistPage } from './pages/wishlist'
import { addressesPage } from './pages/addresses'
import { ecosystemPage } from './pages/ecosystem'
import { ecosystemPreviewPage } from './pages/ecosystem-preview'
import { helpPage } from './pages/help'
import { sellerGatewayPage, sellerOnboardingPage } from './pages/seller'
import { sellerFinancePage } from './pages/seller-stubs'
import { sellerDashboardPage } from './pages/seller-dashboard'
import { sellerProductsPage } from './pages/seller-products'
import { sellerOrdersPage } from './pages/seller-orders'
import { sellerInventoryPage } from './pages/seller-inventory'
import { affiliatePage } from './pages/affiliate'
import { accountPage } from './pages/account'
import { organizationPage } from './pages/organization'

type Bindings = AppEnv['Bindings'] & { PAYSTACK_SECRET_KEY?: string }
type Env = { Bindings: Bindings; Variables: AppEnv['Variables'] }

const app = new Hono<Env>()

app.use(renderer)
app.use('*', attachUser)
// MUST run after attachUser — reads c.get('user') for the logged-in "saved
// preference" priority level. Never blocks the request; see src/i18n/.
app.use('*', attachLocale)
// Affiliate click capture: fails open, only does DB work when ?ref= is
// present (or a returning visitor's cookie needs attaching post-login) — see
// src/lib/affiliate.ts's affiliateClickMiddleware doc comment. MUST run after
// attachUser (reads c.get('user') to opportunistically attach customer_user_id).
app.use('*', affiliateClickMiddleware)

// Static assets (public/static/* -> /static/*)
app.use('/static/*', serveStatic({ root: './public' }))

// Branded SVG placeholder image generator (used everywhere product photos would go)
app.route('/', placeholderRoute)

// ---------- API routes ----------
// /api/version: deployment identity + live migration-parity check. Read this FIRST
// whenever verifying "what's actually running" — see src/routes/version.ts for why.
app.route('/api', versionRoute)
app.route('/api/catalog', catalogApi)
app.route('/api/cart', cartApi)
app.route('/api/auth', authApi)
app.route('/api/orders', ordersApi)
app.route('/api/addresses', addressesApi)
app.route('/api/wallet', walletApi)
app.route('/api/affiliate', affiliateApi)
app.route('/api/account', accountApi)
app.route('/api/organizations', organizationsApi)
app.route('/api/webhooks', webhooksApi)
app.route('/api/wishlist', wishlistApi)
app.route('/api/ecosystem', ecosystemApi)
app.route('/api/i18n', i18nApi)
app.route('/api/seller', sellerApi)
app.route('/api', servicesApi)
app.route('/api', serviceRequestsApi)
app.route('/api', providerApi)

// ---------- SSR pages ----------
app.get('/', homePage)
app.get('/shop', shopPage)
app.get('/shop/:slug', productPage)
app.get('/cart', cartPage)
app.get('/checkout/callback', checkoutCallbackPage)
app.get('/checkout', requireAuthPage, checkoutPage)
app.get('/login', loginPage)
app.get('/register', registerPage)
app.get('/orders', requireAuthPage, ordersListPage)
app.get('/orders/:orderNumber', requireAuthPage, orderDetailPage)
app.get('/wallet', requireAuthPage, walletPage)
app.get('/account', requireAuthPage, accountPage)
app.get('/account/wishlist', requireAuthPage, wishlistPage)
app.get('/account/addresses', requireAuthPage, addressesPage)
// Organization dashboard — ownership resolved server-side inside organizationPage
// itself (via resolveMembership), so this only needs requireAuthPage (must be
// signed in); a non-member gets the same "not found" response a nonexistent
// organization would (Section 27: no organization enumeration).
app.get('/organizations/:organizationId', requireAuthPage, organizationPage)
app.get('/ecosystem', ecosystemPage)
app.get('/help', helpPage)

// /affiliate — the Affiliate program gateway. Like /seller, it resolves
// Guest / Authenticated-not-enrolled / Enrolled state itself (src/pages/affiliate.tsx),
// so it deliberately has NO requireAuthPage guard — a guest must be able to
// load it and see the real landing page copy production serves.
app.get('/affiliate', affiliatePage)

// ---------- Ecosystem Preview Pages — one handler, 8 routes ----------
// Every planned NaijaDeals vertical that isn't built yet gets a real, honest
// product-preview page instead of a 404. Content for all 8 routes below is
// 100% config-driven from ecosystem_verticals (migration 0010) via
// ecosystemPreviewPage — there is no per-vertical page file. Flipping any of
// these from coming_soon -> live later is a data change (and, when a real
// engine exists, simply repointing that one line to a different handler),
// never a rebuild of this list.
app.get('/fresh', ecosystemPreviewPage)
app.get('/eats', ecosystemPreviewPage)
app.get('/gigs', ecosystemPreviewPage)
app.get('/stay', ecosystemPreviewPage)
app.get('/drive', ecosystemPreviewPage)
app.get('/send', ecosystemPreviewPage)
app.get('/stream', ecosystemPreviewPage)
app.get('/aura', ecosystemPreviewPage)

// ---------- Seller Portal — Phase 2: gateway + ownership-gated stubs ----------
// /seller is the single destination for every "Sell on NaijaDeals" CTA (see
// Layout.tsx). It resolves Guest / Authenticated-non-seller / Existing-seller
// state itself (src/pages/seller.tsx), so it deliberately has NO requireAuthPage
// guard — a guest must be able to load it and see the landing page.
app.get('/seller', sellerGatewayPage)
// Destination of the "Start selling" CTA for a NO_SELLER user — requireAuthPage
// only (must be signed in); does not require an existing vendor row, since its
// whole purpose is to be reached BEFORE one exists.
app.get('/seller/onboarding', requireAuthPage, sellerOnboardingPage)
// Everything below IS ownership-gated: requireAuthPage first (must be signed in),
// then requireActiveSeller (must have a verified, active vendor row owned by THIS
// user) — see src/lib/seller.ts. Any other state is bounced back to /seller.
app.get('/seller/dashboard', requireAuthPage, requireActiveSeller, sellerDashboardPage)
app.get('/seller/products', requireAuthPage, requireActiveSeller, sellerProductsPage)
app.get('/seller/orders', requireAuthPage, requireActiveSeller, sellerOrdersPage)
app.get('/seller/finance', requireAuthPage, requireActiveSeller, sellerFinancePage)
app.get('/seller/inventory', requireAuthPage, requireActiveSeller, sellerInventoryPage)

export default app
