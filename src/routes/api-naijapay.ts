import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { getNaijaPayProvider, getNaijaPayTransaction, listNaijaPayProviders, listNaijaPayTransactions } from '../lib/naijapay-data'

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

naijaPayApi.get('/providers/:providerKey', async (c) => {
  const provider = await getNaijaPayProvider(c.env.DB, c.req.param('providerKey'))
  if (!provider) return c.json({ error: 'Provider not found' }, 404)
  return c.json({ provider })
})
