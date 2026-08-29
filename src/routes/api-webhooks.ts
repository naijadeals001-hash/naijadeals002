import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { verifyPaystackWebhookSignature } from '../lib/paystack'
import { confirmOrderPayment } from '../lib/orders'
import { creditWallet } from '../lib/wallet'

export const webhooksApi = new Hono<AppEnv & { Bindings: AppEnv['Bindings'] & { PAYSTACK_SECRET_KEY?: string } }>()

/**
 * Paystack webhook — the AUTHORITATIVE source of payment confirmation.
 * The client-side verify-payment/topup-verify routes exist for immediate UX feedback,
 * but this webhook is what we'd rely on if the user closes the tab mid-flow.
 * Every write here is idempotent (guarded by payment_transactions.status check).
 */
webhooksApi.post('/paystack', async (c) => {
  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.text('Not configured', 503)

  const rawBody = await c.req.text()
  const signature = c.req.header('x-paystack-signature')
  const valid = await verifyPaystackWebhookSignature(secretKey, rawBody, signature ?? null)
  if (!valid) return c.text('Invalid signature', 401)

  const event = JSON.parse(rawBody)
  if (event.event !== 'charge.success') return c.text('OK', 200) // ignore other event types

  const reference: string = event.data.reference
  const amountKobo: number = event.data.amount

  const tx = await c.env.DB.prepare('SELECT * FROM payment_transactions WHERE provider_reference = ?')
    .bind(reference)
    .first<any>()
  if (!tx) return c.text('OK', 200) // unknown reference, nothing to do
  if (tx.status === 'success') return c.text('OK', 200) // already processed — idempotent

  await c.env.DB.prepare("UPDATE payment_transactions SET status = 'success', raw_payload = ? WHERE id = ?")
    .bind(rawBody, tx.id)
    .run()

  if (tx.order_id) {
    await confirmOrderPayment(c.env.DB, tx.order_id, 'paystack', reference)
  } else {
    // No order_id means this was a wallet top-up transaction
    await creditWallet(c.env.DB, tx.user_id, amountKobo, 'topup', reference, 'Wallet top-up via Paystack (webhook)')
  }

  return c.text('OK', 200)
})
