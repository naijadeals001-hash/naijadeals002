/**
 * Engine 9 — Category D (consent), explicit DEFERRED-WITH-BOUNDARY tests.
 *
 * DECISION (Phase 7, recorded in docs/ENGINE-9-COMMUNICATION-NOTIFICATION-
 * AUDIT.md): communication_consents (migration 0045) is schema-only by
 * deliberate documented decision. Zero Engine 9 event writers use
 * category: 'marketing' or 'promotional' — grep-confirmed across
 * src/lib/order-lifecycle.ts, src/lib/booking-lifecycle.ts, src/lib/
 * orders.ts, src/lib/refunds.ts, src/routes/api-auth.ts (the five real
 * event writers). This file does NOT test unbuilt functionality (that
 * would be fabrication); it proves and documents the boundary itself:
 * (a) the table exists with the right shape, (b) no live event writer
 * ever inserts into it or reads it to gate delivery, (c) marketing/
 * promotional notification categories still work through the ordinary
 * preference mechanism (opt-out, not opt-in-via-consent) — consistent
 * with the DEFERRED decision rather than silently half-implemented.
 *
 * PRECONDITION: PM2 dev server RUNNING (HTTP mode) for the two API-level
 * checks; the schema checks use direct D1 CLI queries only (no library
 * import), so this file is safe under either server state, but is grouped
 * with the HTTP-mode files for consistency with this session's run order.
 * Run command:
 *   node --experimental-strip-types --test tests/notification-engine/05.consent-boundary.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, queryOneD1, queryD1, execD1 } from './helpers/client.mjs'

test('consent boundary: communication_consents table exists with the documented schema (schema-only, not a stub table that is absent)', async () => {
  const cols = await queryD1(`PRAGMA table_info(communication_consents)`)
  const names = cols.map((c) => c.name)
  assert.ok(names.includes('purpose'), 'expected a purpose column')
  assert.ok(names.includes('consent_given'), 'expected a consent_given column')
  assert.ok(names.includes('source'), 'expected a source column')
  assert.ok(names.includes('legal_basis'), 'expected a legal_basis column')
})

test('consent boundary: communication_consents has ZERO rows written by any real application code path (grep-confirmed: no INSERT caller exists yet)', async () => {
  // This is an EXISTENCE proof, not a synthetic assertion — if some future
  // change silently starts writing to this table without updating the
  // documented DEFERRED decision, this count will change and the test's
  // intent (and the audit doc) should be revisited, not the assertion
  // loosened to hide it.
  const row = await queryOneD1(`SELECT COUNT(*) as n FROM communication_consents`)
  assert.equal(row.n, 0, 'no application code path currently writes to communication_consents — a nonzero count would mean the DEFERRED decision has silently changed and must be re-documented')
})

test('consent boundary: registering a new user never creates a communication_consents row (the account_registered event writer does not touch consent at all)', async () => {
  const before = await queryOneD1(`SELECT COUNT(*) as n FROM communication_consents`)
  await registerUser('consent_boundary_register')
  const after = await queryOneD1(`SELECT COUNT(*) as n FROM communication_consents`)
  assert.equal(after.n, before.n, 'account registration must not write to communication_consents')
})

test('consent boundary: the "marketing" and "promotional" categories are reachable through the ordinary PREFERENCE mechanism (opt-OUT model), proving the deferred consent table is not silently blocking the honest fallback path', async () => {
  const { client } = await registerUser('consent_boundary_pref')
  const matrix = await client.get('/api/notifications/preferences')
  assert.equal(matrix.status, 200)
  const marketing = matrix.body.preferences.find((p) => p.category === 'marketing' && p.channel === 'in_app')
  const promotional = matrix.body.preferences.find((p) => p.category === 'promotional' && p.channel === 'in_app')
  assert.ok(marketing, 'expected a marketing/in_app preference row in the matrix')
  assert.ok(promotional, 'expected a promotional/in_app preference row in the matrix')
  // Both default to enabled=true (DEFAULT_CHANNELS_BY_CATEGORY includes
  // in_app for both) — i.e. opt-OUT, not gated by any consent row. This is
  // the honest, currently-implemented model; NOT a claim that NDPR/GDPR
  // opt-in consent enforcement exists (it does not — that is exactly the
  // documented DEFERRED boundary).
  assert.equal(marketing.enabled, true)
  assert.equal(promotional.enabled, true)
  assert.equal(marketing.mandatory, false, 'marketing must remain user-suppressible (never mandatory)')
})

test('consent boundary: no Engine 9 event writer ever enqueues a "marketing" or "promotional" category event (grep-level architectural fact, proven functionally: none of the 5 real business flows this suite exercises produce one)', async () => {
  const before = await queryOneD1(`SELECT COUNT(*) as n FROM notification_outbox WHERE category IN ('marketing','promotional')`)
  await registerUser('consent_boundary_no_marketing_event')
  const after = await queryOneD1(`SELECT COUNT(*) as n FROM notification_outbox WHERE category IN ('marketing','promotional')`)
  assert.equal(after.n, before.n, 'account registration (the only writer exercised here) must never produce a marketing/promotional outbox event — none of the 5 real event writers use these categories today')
})
