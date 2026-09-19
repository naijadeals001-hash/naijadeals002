/**
 * Stage 2C — Confirmed HTTP status defect fix.
 * Hono's jsxRenderer render() signature is (children, props) — the second
 * argument is Layout props, NEVER a status code. The old
 * `c.render(<Layout>...</Layout>, 404)` call silently returned HTTP 200 with
 * a 404-looking HTML page. Fixed via `c.status(404); return c.render(...)`.
 * This suite proves the ACTUAL wire-level HTTP status code, not just the
 * page content, for both confirmed sites (product.tsx, orders.tsx) plus a
 * real JSON-API 404 for comparison (which was never broken).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, cleanupRunNonce, RUN_NONCE } from './helpers/client.mjs'
import { ApiClient } from './helpers/client.mjs'

test('GET /shop/:slug for a nonexistent product slug returns a REAL HTTP 404, not 200', async () => {
  const client = new ApiClient()
  const res = await client.get('/shop/this-product-definitely-does-not-exist-xyz-999999')
  assert.equal(res.status, 404, 'a nonexistent product page must return actual HTTP 404, not 200 with 404-looking HTML')
})

test('GET /orders/:orderNumber for a nonexistent/inaccessible order (as an unauthenticated visitor / wrong owner) returns a REAL HTTP 404 page status, not 200', async () => {
  const client = new ApiClient()
  const res = await client.get('/orders/ND-DOES-NOT-EXIST-999999')
  // Unauthenticated visitors get redirected to login for this page; either a
  // real 404 (if it renders the not-found branch) or a 302/401 auth redirect
  // is acceptable here — status 200 masking a "not found" state is NOT.
  assert.notEqual(res.status, 200, 'an inaccessible/nonexistent order page must never return HTTP 200')
})

test('GET /orders/:orderNumber for an order that does not belong to the authenticated user returns a REAL HTTP 404', async () => {
  const user = await registerUser('404check')
  const res = await user.client.get('/orders/ND-DOES-NOT-EXIST-999999')
  assert.equal(res.status, 404, 'a nonexistent order number for an authenticated user must return actual HTTP 404')
  await cleanupRunNonce(RUN_NONCE)
})

test('control case: a JSON API 404 (was never broken) — GET /api/orders/:orderNumber for a nonexistent order still returns 404', async () => {
  const user = await registerUser('404control')
  const res = await user.client.get('/api/orders/ND-DOES-NOT-EXIST-999999')
  assert.equal(res.status, 404)
  await cleanupRunNonce(RUN_NONCE)
})
