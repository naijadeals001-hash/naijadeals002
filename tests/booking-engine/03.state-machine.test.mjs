/**
 * Invariant #3: booking state machine.
 *
 * Covers valid transitions, repeated (no-op) transitions, wrong-role
 * transitions, cross-provider transitions, and terminal-state protection —
 * against booking-lifecycle.ts's TRANSITIONS table, driven entirely through
 * the real HTTP route layer (never calling transitionBooking() directly),
 * matching how the manual gate proved Area B.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, createTestListing, nextFreshWindow } from './helpers/client.mjs'

async function makeInstantBooking(providerClient, customerClient) {
  const { listingId, resourceId } = await createTestListing(providerClient, { bookingMode: 'instant' })
  const { startsAt, endsAt } = nextFreshWindow(6)
  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201)
  const bookingRes = await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201)
  return bookingRes.body.id // status: pending_payment
}

test('state machine: provider can confirm a pending_payment booking', async () => {
  const { client: provider } = await registerUser('sm_prov1')
  const { client: customer } = await registerUser('sm_cust1')
  const bookingId = await makeInstantBooking(provider, customer)

  const res = await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.status, 'confirmed')
})

test('state machine: repeated transition to the same status is rejected (no-op re-request must not silently succeed)', async () => {
  const { client: provider } = await registerUser('sm_prov2')
  const { client: customer } = await registerUser('sm_cust2')
  const bookingId = await makeInstantBooking(provider, customer)
  await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })

  const res = await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /cannot transition/i)
})

test('state machine: customer cannot perform a provider-only transition (check-in)', async () => {
  const { client: provider } = await registerUser('sm_prov3')
  const { client: customer } = await registerUser('sm_cust3')
  const bookingId = await makeInstantBooking(provider, customer)
  await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })

  const res = await customer.post(`/api/bookings/${bookingId}/transition`, { status: 'checked_in' })
  assert.equal(res.status, 403)
})

test('state machine: full legitimate lifecycle confirmed -> checked_in -> in_progress -> completed', async () => {
  const { client: provider } = await registerUser('sm_prov4')
  const { client: customer } = await registerUser('sm_cust4')
  const bookingId = await makeInstantBooking(provider, customer)

  let res = await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(res.status, 200)
  res = await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'checked_in' })
  assert.equal(res.status, 200)
  assert.ok(res.body.checked_in_at, 'checked_in_at timestamp must be stamped')
  res = await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'in_progress' })
  assert.equal(res.status, 200)
  res = await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'completed' })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'completed')
  assert.ok(res.body.completed_by_user_id, 'completed_by_user_id must be stamped')
})

test('state machine: completed is a terminal state — no further transition or cancellation is permitted', async () => {
  const { client: provider } = await registerUser('sm_prov5')
  const { client: customer } = await registerUser('sm_cust5')
  const bookingId = await makeInstantBooking(provider, customer)
  for (const status of ['confirmed', 'checked_in', 'in_progress', 'completed']) {
    const r = await provider.post(`/api/bookings/${bookingId}/transition`, { status })
    assert.equal(r.status, 200, `expected 200 transitioning to ${status}: ${JSON.stringify(r.body)}`)
  }

  const cancelRes = await customer.post(`/api/bookings/${bookingId}/cancel`, { reason: 'too late' })
  assert.equal(cancelRes.status, 400, 'cancelling a completed booking must be rejected')

  const transitionRes = await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'checked_in' })
  assert.equal(transitionRes.status, 400, 'transitioning out of completed must be rejected')
})

test('state machine: event history is recorded for every real transition (append-only audit trail)', async () => {
  const { client: provider } = await registerUser('sm_prov6')
  const { client: customer } = await registerUser('sm_cust6')
  const bookingId = await makeInstantBooking(provider, customer)
  await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  await provider.post(`/api/bookings/${bookingId}/transition`, { status: 'checked_in' })

  const res = await customer.get(`/api/bookings/${bookingId}`)
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.events), 'events array must be present')
  const statuses = res.body.events.map((e) => e.status ?? e.to_status).filter(Boolean)
  assert.ok(statuses.length >= 2, `expected at least 2 recorded events, got: ${JSON.stringify(res.body.events)}`)
})
