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
import { adminApi } from './routes/api-admin'
import { notificationsApi } from './routes/api-notifications'
import { bookingsApi } from './routes/api-bookings'
import { logisticsApi } from './routes/api-logistics'
import { apiControlCenterRoutes } from './routes/api-control-center'

// SSR pages
import { homePage } from './pages/home'
import { shopPage } from './pages/shop'
import { categoriesPage, popularCategoriesPage } from './pages/categories'
import { countriesPage } from './pages/countries'
import { countryDetailPage } from './pages/country-detail'
import { vendorsPage } from './pages/vendors'
import { brandsPage } from './pages/brands'
import { productPage } from './pages/product'
import { cartPage } from './pages/cart'
import { checkoutPage, checkoutCallbackPage } from './pages/checkout'
import { loginPage, registerPage } from './pages/auth'
import { ordersListPage, orderDetailPage } from './pages/orders'
import { walletPage } from './pages/wallet'
import { naijapayPage } from './pages/naijapay'
import { wishlistPage } from './pages/wishlist'
import { addressesPage } from './pages/addresses'
import { ecosystemPage } from './pages/ecosystem'
import { ecosystemPreviewPage } from './pages/ecosystem-preview'
import { auraPage } from './pages/aura'
import { helpPage } from './pages/help'
import { aboutPage, careersPage, termsPage, privacyPage, sellerTermsPage } from './pages/company'
import { sellerGatewayPage, sellerOnboardingPage } from './pages/seller'
import { sellerFinancePage } from './pages/seller-stubs'
import { sellerDashboardPage } from './pages/seller-dashboard'
import { sellerProductsPage } from './pages/seller-products'
import { sellerOrdersPage } from './pages/seller-orders'
import { sellerInventoryPage } from './pages/seller-inventory'
import { affiliatePage } from './pages/affiliate'
import {
  gigsHomePage,
  gigsCategoryPage,
  gigsProviderPage,
  gigsListingPage,
  gigsRequestPage,
  gigsDashboardPage,
  gigsRequestDetailPage,
  gigsOrderDetailPage
} from './pages/gigs'
import {
  stayHomePage,
  stayPropertyPage,
  stayBookPage,
  stayDashboardPage,
  stayBookingDetailPage
} from './pages/stay'
import { accountPage } from './pages/account'
import { organizationPage } from './pages/organization'
import { controlCenterRoutes } from './routes/control-center'
import { auraApi } from './routes/api-aura'

type Bindings = AppEnv['Bindings'] & { PAYSTACK_SECRET_KEY?: string; OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
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
// NOTE: bookingsApi is mounted here, BEFORE any sub-app that registers
// `.use('*', requireAuth)` on the shared bare '/api' prefix (e.g.
// servicesApi/serviceRequestsApi below). Hono's router applies wildcard
// middleware from EVERY sub-app sharing a mount path in REGISTRATION
// ORDER, not scoped per sub-app — discovered via live smoke-testing when
// serviceRequestsApi's '*' requireAuth was silently intercepting this
// engine's public GET /api/bookable-listings routes. Registering
// bookingsApi first ensures its own explicitly-scoped middleware (never a
// bare '*') is what actually governs its routes.
app.route('/api', bookingsApi)
app.route('/api', logisticsApi)
// Aura AI Core (Phase 3A) — one shared endpoint for every Aura experience
// (Luxe/Classic/Pulse/Executive). Deliberately NOT behind requireAuth (Aura
// must work for guests — Aura Luxe's guest state is part of the locked UI).
// MUST be registered here, alongside bookingsApi/logisticsApi, and BEFORE
// servicesApi/serviceRequestsApi/providerApi below — those register a bare
// `.use('*', requireAuth)` on the shared '/api' prefix, and Hono applies
// wildcard middleware from every sub-app sharing a mount path in
// REGISTRATION ORDER (see the bookingsApi comment above for the same bug,
// first discovered there). Registering auraApi first means its own
// intentionally-absent auth requirement is what actually governs it.
app.route('/api/aura', auraApi)
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
app.route('/api/admin', adminApi)
app.route('/api/notifications', notificationsApi)
// Enterprise Control Center privileged mutation API — see
// src/lib/control-center-rbac.ts's doc comment for the full auth chain
// (Engine 1 session -> cc_user_roles -> granular cc_permissions). Gated
// entirely within apiControlCenterRoutes itself (requireControlCenterApiAuth
// on '*', then per-route requireControlCenterPermission), never by anything
// mounted here.
app.route('/api/control-center', apiControlCenterRoutes)


// ---------- SSR pages ----------
app.get('/', homePage)
app.get('/shop', shopPage)
// Real category discovery pages (Checkpoint B item 7) — genuine "See All"
// destinations for the homepage's Shop by Category / Popular Categories
// rails. Registered BEFORE /shop/:slug's catch-all-looking sibling only
// because they're a completely separate path prefix, but ordered here for
// readability alongside the other /shop* routes. NOTE: must also be
// registered before nothing conflicting — /categories/popular is a static
// path, not a param, so route order relative to /categories doesn't matter,
// but Hono matches most-specific-first regardless.
app.get('/categories', categoriesPage)
app.get('/categories/popular', popularCategoriesPage)
app.get('/countries', countriesPage)
app.get('/countries/:iso', countryDetailPage)
app.get('/vendors', vendorsPage)
app.get('/brands', brandsPage)
app.get('/shop/:slug', productPage)
app.get('/cart', cartPage)
app.get('/checkout/callback', checkoutCallbackPage)
app.get('/checkout', requireAuthPage, checkoutPage)
app.get('/login', loginPage)
app.get('/register', registerPage)
app.get('/orders', requireAuthPage, ordersListPage)
app.get('/orders/:orderNumber', requireAuthPage, orderDetailPage)
app.get('/wallet', requireAuthPage, walletPage)
// /naijapay — Phase 1 production rebrand of the wallet experience (see
// src/pages/naijapay.tsx header comment). Built ALONGSIDE /wallet, not as a
// replacement: /wallet above is intentionally untouched. Only real wallet
// data (src/lib/naijapay-experience.ts -> wallet_ledger/wallet_accounts) is
// rendered; every reference-image feature without real backend support
// (Pending/Reserved/Rewards/Cashback/Cards/Business Wallet/etc.) is rendered
// disabled with a "Coming Soon" badge. Do not cut over /wallet to this route
// until full QA (dev/integration/financial/mobile/security/prod smoke test)
// has explicitly been approved.
app.get('/naijapay', requireAuthPage, naijapayPage)
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

// Unit 5A (Footer & Navigation Truth Pass) — real company/legal destinations
// replacing the footer's previous placeholder pattern (Careers -> /admin;
// Privacy/Terms/Seller Terms/Payment Terms all -> /help). See
// src/pages/company.tsx's header comment for the full rationale.
app.get('/about', aboutPage)
app.get('/careers', careersPage)
app.get('/terms', termsPage)
app.get('/privacy', privacyPage)
app.get('/seller-terms', sellerTermsPage)

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
app.get('/drive', ecosystemPreviewPage)
app.get('/send', ecosystemPreviewPage)
app.get('/stream', ecosystemPreviewPage)

// ---------- Aura AI — Aura Experience Engine (Phase 1: Aura Luxe) ----------
// /aura used to route to the static ecosystemPreviewPage placeholder above.
// It now renders the real Aura Luxe desktop experience (src/pages/aura.tsx),
// resolved via the Aura Experience Engine (src/lib/aura-experience.ts,
// migration 0074). Deliberately NOT behind requireAuthPage — a guest can
// browse the Aura Luxe shell (shortcuts, hero, recommendations) exactly like
// /shop's guest-browsable pattern; only the account-specific right panel
// (wallet/orders/bookings/deliveries) is gated inside the page itself on
// `c.get('user')` being present.
app.get('/aura', auraPage)

// ---------- NaijaGigs — real UI on top of the pre-existing Service Engine 2.0 ----------
// /gigs used to route to the static ecosystemPreviewPage placeholder above.
// The Service Engine (migrations 0024, 0025, 0039) + demo seed (migration
// 0072) are real, so this vertical now gets real pages instead of a
// "coming soon" card. Dashboard/request routes require auth (a request/
// order belongs to a specific customer); browse/detail routes are public,
// mirroring /shop's guest-browsable pattern.
app.get('/gigs', gigsHomePage)
app.get('/gigs/category/:slug', gigsCategoryPage)
app.get('/gigs/providers/:id', gigsProviderPage)
app.get('/gigs/listings/:id', gigsListingPage)
app.get('/gigs/request', requireAuthPage, gigsRequestPage)
app.get('/gigs/dashboard', requireAuthPage, gigsDashboardPage)
app.get('/gigs/dashboard/requests/:id', requireAuthPage, gigsRequestDetailPage)
app.get('/gigs/dashboard/orders/:id', requireAuthPage, gigsOrderDetailPage)

// ---------- NaijaStay — real UI on top of the pre-existing Booking Engine 2.0 ----------
// /stay used to route to the static ecosystemPreviewPage placeholder above.
// The Booking Engine (migrations 0024/0028/0034/0041/0043) + Stay demo
// seed (migration 0073) are real, so this vertical now gets real pages
// instead of a "coming soon" card. NOTE: ecosystem_verticals.stay.status
// remains 'coming_soon' until the full local + production E2E booking
// lifecycle (hold -> confirm -> pay -> cancel/refund) has been verified —
// see migration 0073's own closing comment. Dashboard/booking-detail
// routes require auth (a booking belongs to a specific customer);
// browse/property/book-flow-entry routes are public, mirroring /gigs' and
// /shop's guest-browsable pattern (the book flow itself still requires the
// customer to be signed in before it can create a hold, enforced by
// requireAuthPage here rather than inside the page).
app.get('/stay', stayHomePage)
app.get('/stay/property/:slug', stayPropertyPage)
app.get('/stay/book/:listingId', requireAuthPage, stayBookPage)
app.get('/stay/dashboard', requireAuthPage, stayDashboardPage)
app.get('/stay/dashboard/bookings/:id', requireAuthPage, stayBookingDetailPage)

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

// ---------- Enterprise Control Center — Phase 1 (Sections 4-19) ----------
// Deliberately mounted as its own sub-app rather than individual app.get()
// lines: controlCenterRoutes owns its OWN full auth chain internally
// (real POST /login + POST /logout are UNGATED by design so a
// Control-Center-authorized-but-not-yet-authenticated visitor can reach
// them, then EVERYTHING else registered after
// `controlCenterRoutes.use('*', requireControlCenterAuth)` inside that file
// is gated). No route in this mount is ever reachable without passing a
// genuine server-side authorization check — see control-center.ts and
// control-center-rbac.ts.
app.route('/control-center', controlCenterRoutes)

export default app
