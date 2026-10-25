import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { getNaijaPayProvider, getNaijaPayTransaction, listNaijaPayProviders, listNaijaPayTransactions } from '../lib/naijapay-data'
import { createPaymentIntent, recordPaymentEvent, transitionPaymentIntent } from '../lib/payment-engine'

export const naijaPayApi = new Hono<AppEnv>()
naijaPayApi.use('*', requireAuth)

function positiveInt(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

naijaPayApi.get('/transactions', async (c) => {
  const user = c.get('user')!
  const page = positiveInt(c.req.query('page'), 1, 100000)
  const pageSize = positiveInt(c.req.query('page_size'), 20, 100)
  const status = c.req.query('status')
  const category = c.req.query('category')
  const currency = c.req.query('currency')?.toUpperCase()
  const allowedStatuses = new Set(['created', 'pending', 'authorized', 'succeeded', 'failed', 'reversed', 'refunded', 'disputed', 'cancelled'])
  if (status && !allowedStatuses.has(status)) return c.json({ error: 'Unsupported transaction status' }, 400)
  if (currency && !/^[A-Z]{3}$/.test(currency)) return c.json({ error: 'currency must be an ISO 4217 code' }, 400)
  const result = await listNaijaPayTransactions(c.env.DB, { userId: user.id, page, pageSize, status, category, currency })
  return c.json({ ...result, total_pages: Math.max(1, Math.ceil(result.total / result.pageSize)) })
})

naijaPayApi.get('/payment-intents/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid payment intent id' }, 400)
  const intent = await getNaijaPayTransaction(c.env.DB, id, c.get('user')!.id)
  if (!intent) return c.json({ error: 'Payment intent not found' }, 404)
  return c.json({ intent })
})

naijaPayApi.get('/providers', async (c) => c.json({ providers: await listNaijaPayProviders(c.env.DB) }))

naijaPayApi.get('/utilities/catalog', async (c) => {
  const country = (c.req.query('country') || 'NG').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return c.json({ error: 'Invalid country' }, 400)
  const rows = await c.env.DB.prepare(`SELECT pr.provider_key, pr.display_name, pr.category, pr.operational_status, pr.environment, pr.configuration_status, pr.authorization_status, pr.health_status, p.id, p.product_code, p.display_name AS product_name, p.currency, p.operation, p.operational_status AS product_status, p.metadata_json FROM naijapay_products p JOIN naijapay_providers pr ON pr.id=p.provider_id WHERE p.country_iso=? ORDER BY pr.category, pr.display_name, p.display_name`).bind(country).all()
  return c.json({ country, sandbox_only: true, products: rows.results })
})

naijaPayApi.post('/utilities/validate', async (c) => {
  const body = await c.req.json<{ category?: string; identifier?: string; country?: string }>().catch(() => null)
  if (!body?.category || !body.identifier) return c.json({ error: 'category and identifier are required' }, 400)
  const identifier = body.identifier.replace(/\s+/g, '')
  const valid = body.category === 'airtime' || body.category === 'data' ? /^\+?[0-9]{10,15}$/.test(identifier) : /^[A-Za-z0-9-]{6,32}$/.test(identifier)
  if (!valid) return c.json({ valid: false, error: 'Identifier format is invalid for this service' }, 400)
  return c.json({ valid: true, sandbox: true, account_name: 'SANDBOX CUSTOMER', identifier })
})

naijaPayApi.post('/utilities/quote', async (c) => {
  const body = await c.req.json<{ product_id?: number; amount_minor?: number }>().catch(() => null)
  if (!body?.product_id || !Number.isInteger(body.product_id)) return c.json({ error: 'product_id is required' }, 400)
  const product = await c.env.DB.prepare(`SELECT p.*, pr.provider_key, pr.category, pr.operational_status, pr.environment, pr.configuration_status, pr.authorization_status, pr.health_status FROM naijapay_products p JOIN naijapay_providers pr ON pr.id=p.provider_id WHERE p.id=?`).bind(body.product_id).first<any>()
  if (!product) return c.json({ error: 'Product not found' }, 404)
  if (product.product_status === 'disabled' || product.operational_status !== 'sandbox') return c.json({ error: 'Product is not available', code: 'PRODUCT_NOT_AVAILABLE' }, 409)
  const amount = Number(body.amount_minor || JSON.parse(product.metadata_json || '{}').amount_minor || 0)
  if (!Number.isSafeInteger(amount) || amount <= 0) return c.json({ error: 'A positive amount in minor units is required' }, 400)
  const fee = Math.max(50, Math.floor(amount * 0.01))
  return c.json({ quote: { product_id: product.id, provider_key: product.provider_key, category: product.category, currency: product.currency, amount_minor: amount, fee_minor: fee, total_minor: amount + fee, expires_in_seconds: 300, sandbox: true } })
})

naijaPayApi.post('/utilities/purchase', async (c) => {
  const user = c.get('user')!
  const key = c.req.header('Idempotency-Key')
  const body = await c.req.json<{ product_id?: number; identifier?: string; amount_minor?: number }>().catch(() => null)
  if (!key) return c.json({ error: 'Idempotency-Key header is required' }, 400)
  if (!body?.product_id || !body.identifier || !Number.isSafeInteger(body.amount_minor) || body.amount_minor <= 0) return c.json({ error: 'product_id, identifier and positive amount_minor are required' }, 400)
  const product = await c.env.DB.prepare(`SELECT p.*, p.operational_status AS product_status, pr.provider_key, pr.category, pr.operational_status AS provider_status, pr.environment FROM naijapay_products p JOIN naijapay_providers pr ON pr.id=p.provider_id WHERE p.id=?`).bind(body.product_id).first<any>()
  if (!product || product.operational_status !== 'sandbox' || product.product_status !== 'sandbox') return c.json({ error: 'Only configured sandbox products are available', code: 'PROVIDER_NOT_READY' }, 409)
  const intent = await createPaymentIntent(c.env.DB, { idempotencyKey: key, userId: user.id, verticalKey: `utility.${product.category}`, countryIso: product.country_iso, currency: product.currency, amountMinor: body.amount_minor, fundingMethod: 'wallet', merchantReference: body.identifier })
  if (intent.created) {
    await transitionPaymentIntent(c.env.DB, intent.intent.id, 'created', 'succeeded')
    await recordPaymentEvent(c.env.DB, intent.intent.id, 'sandbox.fulfillment', { identifier: body.identifier, product_id: product.id }, product.provider_key, `SANDBOX-${intent.intent.transactionReference}`)
  }
  return c.json({ sandbox: true, outcome: 'succeeded', receipt: { transaction_reference: intent.intent.transactionReference, payment_intent_id: intent.intent.id, category: product.category, product: product.product_name, currency: product.currency, amount_minor: body.amount_minor, identifier: body.identifier, provider_reference: `SANDBOX-${intent.intent.transactionReference}` } }, intent.created ? 201 : 200)
})

naijaPayApi.get('/providers/:providerKey', async (c) => {
  const provider = await getNaijaPayProvider(c.env.DB, c.req.param('providerKey'))
  if (!provider) return c.json({ error: 'Provider not found' }, 404)
  return c.json({ provider })
})
