import { Hono } from 'hono'
import { renderer } from './renderer'
import { serveStatic } from 'hono/cloudflare-workers'
import type { AppEnv } from './types'
import { attachUser, requireAuthPage } from './lib/auth'

// API sub-apps
import { catalogApi } from './routes/api-catalog'
import { cartApi } from './routes/api-cart'
import { authApi } from './routes/api-auth'
import { ordersApi } from './routes/api-orders'
import { addressesApi } from './routes/api-addresses'
import { walletApi } from './routes/api-wallet'
import { webhooksApi } from './routes/api-webhooks'
import { wishlistApi } from './routes/api-wishlist'
import { placeholderRoute } from './routes/placeholder'
import { versionRoute } from './routes/version'

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
import { helpPage } from './pages/help'

type Bindings = AppEnv['Bindings'] & { PAYSTACK_SECRET_KEY?: string }
type Env = { Bindings: Bindings; Variables: AppEnv['Variables'] }

const app = new Hono<Env>()

app.use(renderer)
app.use('*', attachUser)

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
app.route('/api/webhooks', webhooksApi)
app.route('/api/wishlist', wishlistApi)

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
app.get('/account/wishlist', requireAuthPage, wishlistPage)
app.get('/account/addresses', requireAuthPage, addressesPage)
app.get('/ecosystem', ecosystemPage)
app.get('/help', helpPage)

export default app
