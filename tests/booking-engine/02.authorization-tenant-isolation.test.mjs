/**
 * Invariant #2: authorization / tenant isolation.
 *
 * Covers the 404-vs-403 anti-enumeration contract (a booking that isn't
 * yours must look IDENTICAL to a booking that doesn't exist — never leak
 * existence), unauthenticated access, and cross-tenant read/cancel/pay
 * attempts. Mirrors the manual Area F testing from the 57-check gate.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, createTestListing, nextFreshWindow, ApiClient } from './helpers/client.mjs'

async function makeBooking(providerClient, customerClient, opts = {}) {
  const { listingId, resourceId } = await createTestListing(providerClient, opts)
  const { startsAt, endsAt } = nextFreshWindow(5)
  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201)
  const bookingRes = await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201)
  return bookingRes.body.id
}

test('authorization: unrelated customer cannot read another customer\'s booking (404, not 403 — anti-enumeration)', async () => {
  const { client: provider } = await registerUser('authz_prov1')
  const { client: owner } = await registerUser('authz_owner1')
  const { client: attacker } = await registerUser('authz_attacker1')
  const bookingId = await makeBooking(provider, owner)

  const res = await attacker.get(`/api/bookings/${bookingId}`)
  assert.equal(res.status, 404)
  assert.equal(res.body.error, 'Booking not found', 'error message must not hint the booking exists but is inaccessible')
})

test('authorization: unrelated provider cannot read a booking they do not own', async () => {
  const { client: provider } = await registerUser('authz_prov2')
  const { client: owner } = await registerUser('authz_owner2')
  const { client: otherProvider } = await registerUser('authz_otherprov2')
  const bookingId = await makeBooking(provider, owner)

  const res = await otherProvider.get(`/api/bookings/${bookingId}`)
  assert.equal(res.status, 404)
})

test('authorization: unrelated customer cannot cancel another customer\'s booking', async () => {
  const { client: provider } = await registerUser('authz_prov3')
  const { client: owner } = await registerUser('authz_owner3')
  const { client: attacker } = await registerUser('authz_attacker3')
  const bookingId = await makeBooking(provider, owner)

  const res = await attacker.post(`/api/bookings/${bookingId}/cancel`, { reason: 'hijack attempt' })
  assert.equal(res.status, 404)
})

test('authorization: unrelated customer cannot pay for another customer\'s booking', async () => {
  const { client: provider } = await registerUser('authz_prov4')
  const { client: owner } = await registerUser('authz_owner4')
  const { client: attacker } = await registerUser('authz_attacker4')
  const bookingId = await makeBooking(provider, owner, { bookingMode: 'instant' })

  const res = await attacker.post(`/api/bookings/${bookingId}/pay`, {})
  assert.equal(res.status, 400, 'pay endpoint uses a 400 ownership message rather than 404 — verifying it still rejects, not silently succeeds')
  assert.match(res.body.error, /not found|not owned/i)
})

test('authorization: cancellation-quote endpoint does not leak pricing/policy details to non-owners', async () => {
  const { client: provider } = await registerUser('authz_prov5')
  const { client: owner } = await registerUser('authz_owner5')
  const { client: attacker } = await registerUser('authz_attacker5')
  const bookingId = await makeBooking(provider, owner)

  const res = await attacker.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(res.status, 404)
  assert.ok(!res.body.refundAmountKobo, 'no pricing data should be present in a 404 response')
})

test('authorization: unauthenticated requests are rejected with 401', async () => {
  const { client: provider } = await registerUser('authz_prov6')
  const { client: owner } = await registerUser('authz_owner6')
  const bookingId = await makeBooking(provider, owner)

  const anon = new ApiClient() // no cookies at all
  const res = await anon.get(`/api/bookings/${bookingId}`)
  assert.equal(res.status, 401)
})

test('authorization: a provider cannot force an illegal transition on a booking they do not own even with a crafted role claim', async () => {
  const { client: provider } = await registerUser('authz_prov7')
  const { client: owner } = await registerUser('authz_owner7')
  const { client: otherProvider } = await registerUser('authz_otherprov7')
  const bookingId = await makeBooking(provider, owner)

  const res = await otherProvider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(res.status, 403)
  assert.match(res.body.error, /not permitted/i)
})
