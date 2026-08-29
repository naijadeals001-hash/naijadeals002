/**
 * Paystack integration helpers.
 *
 * Requires PAYSTACK_SECRET_KEY set as a Cloudflare secret in production
 * (wrangler secret put PAYSTACK_SECRET_KEY) and in .dev.vars locally.
 * Test-mode keys (sk_test_...) work identically to live keys against the same API.
 *
 * We deliberately do NOT trust the client-side "payment successful" callback alone —
 * webhook signature verification (verifyPaystackWebhookSignature) or a server-side
 * verify call against Paystack's API is required before we ever mark an order paid.
 */

const PAYSTACK_BASE = 'https://api.paystack.co'

export interface PaystackInitResult {
  authorization_url: string
  access_code: string
  reference: string
}

export async function initializePaystackTransaction(
  secretKey: string,
  params: { email: string; amountKobo: number; reference: string; callbackUrl: string }
): Promise<PaystackInitResult> {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo, // Paystack also uses kobo — convenient, no conversion needed
      reference: params.reference,
      callback_url: params.callbackUrl
    })
  })

  const data = await res.json<any>()
  if (!data.status) {
    throw new Error(data.message || 'Paystack initialization failed')
  }
  return data.data as PaystackInitResult
}

export async function verifyPaystackTransaction(secretKey: string, reference: string) {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` }
  })
  const data = await res.json<any>()
  if (!data.status) {
    throw new Error(data.message || 'Paystack verification failed')
  }
  return data.data as { status: string; amount: number; reference: string; customer: { email: string } }
}

/** Verifies the X-Paystack-Signature header using HMAC-SHA512, per Paystack docs. */
export async function verifyPaystackWebhookSignature(
  secretKey: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  const computedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return computedHex === signatureHeader
}
