/**
 * Payment Engine — Paystack webhook delivery simulator for Unit 3 tests.
 *
 * Computes a REAL HMAC-SHA512 x-paystack-signature header using the exact
 * same algorithm as src/lib/paystack.ts's verifyPaystackWebhookSignature(),
 * against the SAME PAYSTACK_SECRET_KEY the running dev server reads from
 * .dev.vars (a throwaway local-only test value — see .dev.vars, which is
 * gitignored and never committed). This lets these tests drive the REAL
 * signature-verification code path end-to-end (never a mocked/bypassed
 * signature check) while still being fully deterministic and offline (no
 * real Paystack account or network call to Paystack involved — only OUR
 * OWN webhook endpoint is exercised, exactly as Paystack's servers would
 * exercise it).
 */
import { BASE_URL } from '../../booking-engine/helpers/client.mjs'

const TEST_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY_FOR_TESTS ?? 'sk_test_unit3harness1234567890'

async function computeSignature(rawBody) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(TEST_SECRET_KEY), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  return Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Sends a simulated `charge.success` Paystack webhook delivery to the real
 * running dev server's /api/webhooks/paystack route, with a genuine valid
 * HMAC signature. Returns { status, text }.
 */
export async function sendPaystackWebhook({ reference, amountKobo, currency = 'NGN', badSignature = false }) {
  const rawBody = JSON.stringify({
    event: 'charge.success',
    data: { reference, amount: amountKobo, currency, status: 'success' },
  })
  const signature = badSignature ? 'deadbeef'.repeat(16) : await computeSignature(rawBody)
  const res = await fetch(`${BASE_URL}/api/webhooks/paystack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
    body: rawBody,
  })
  const text = await res.text()
  return { status: res.status, text }
}
