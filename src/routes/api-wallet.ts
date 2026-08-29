import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { getWalletBalance, getWalletHistory, creditWallet } from '../lib/wallet'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../lib/paystack'

export const walletApi = new Hono<AppEnv & { Bindings: AppEnv['Bindings'] & { PAYSTACK_SECRET_KEY?: string } }>()

walletApi.use('*', requireAuth)

walletApi.get('/', async (c) => {
  const user = c.get('user')!
  const balance = await getWalletBalance(c.env.DB, user.id)
  const history = await getWalletHistory(c.env.DB, user.id, 30)
  return c.json({ balance_kobo: balance, history })
})

/** Initiates a wallet top-up via Paystack. The wallet is only credited after verified payment. */
walletApi.post('/topup/initialize', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ amount_kobo: number }>().catch(() => null)
  if (!body?.amount_kobo || body.amount_kobo < 10000) {
    return c.json({ error: 'Minimum top-up is ₦100' }, 400)
  }

  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.json({ error: 'Wallet funding is not configured yet' }, 503)

  const reference = `ND-TOPUP-${user.id}-${Date.now()}`
  await c.env.DB.prepare(
    'INSERT INTO payment_transactions (user_id, provider, provider_reference, amount_kobo, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, 'paystack', reference, body.amount_kobo, 'initiated').run()

  const origin = new URL(c.req.url).origin
  const init = await initializePaystackTransaction(secretKey, {
    email: user.email ?? `${user.phone}@naijadeals.com`,
    amountKobo: body.amount_kobo,
    reference,
    callbackUrl: `${origin}/wallet?topup_ref=${reference}`
  })

  return c.json({ authorization_url: init.authorization_url, reference })
})

walletApi.post('/topup/verify', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ reference: string }>().catch(() => null)
  if (!body?.reference) return c.json({ error: 'reference required' }, 400)

  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.json({ error: 'Payments not configured' }, 503)

  const tx = await c.env.DB.prepare(
    "SELECT * FROM payment_transactions WHERE provider_reference = ? AND user_id = ?"
  ).bind(body.reference, user.id).first<any>()
  if (!tx) return c.json({ error: 'Transaction not found' }, 404)
  if (tx.status === 'success') return c.json({ success: true, already_processed: true })

  const verified = await verifyPaystackTransaction(secretKey, body.reference)
  if (verified.status !== 'success') {
    return c.json({ success: false, status: verified.status })
  }

  await c.env.DB.prepare("UPDATE payment_transactions SET status = 'success', raw_payload = ? WHERE id = ?")
    .bind(JSON.stringify(verified), tx.id)
    .run()

  await creditWallet(c.env.DB, user.id, tx.amount_kobo, 'topup', body.reference, 'Wallet top-up via Paystack')

  return c.json({ success: true })
})
