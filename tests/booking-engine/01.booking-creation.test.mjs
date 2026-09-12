/**
 * Invariant #1 (gate mandate, minimum-8 list): booking creation.
 *
 * Covers: hold -> confirm (POST /api/booking-holds -> POST /api/bookings)
 * happy path, server-authoritative pricing (client-supplied price must be
 * ignored — spec's explicit "client cannot modify price" rule verified in
 * booking-holds.ts), per_night unit multiplication, and the two structural
 * validation fixes from the 57-check gate follow-up (clean 400s instead of
 * raw D1 driver errors on malformed/missing fields).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, createTestListing, nextFreshWindow } from './helpers/client.mjs'

test('booking creation: hold -> confirm happy path with server-authoritative pricing (request-mode listing starts at "held")', async () => {
  const { client } = await registerUser('create_cust')
  const { listingId, resourceId } = await createTestListing(client, { basePriceKobo: 500000, bookingMode: 'request' })
  const { startsAt, endsAt } = nextFreshWindow(1)

  const holdRes = await client.post('/api/booking-holds', {
    listing_id: listingId,
    resource_id: resourceId,
    starts_at: startsAt,
    ends_at: endsAt,
    capacity_requested: 1,
  })
  assert.equal(holdRes.status, 201, JSON.stringify(holdRes.body))
  assert.equal(holdRes.body.status, 'active')

  // Attempt to smuggle a client-supplied price — must be silently ignored.
  const bookingRes = await client.post('/api/bookings', {
    hold_id: holdRes.body.id,
    total_price_kobo: 1, // attacker-supplied, must NOT be honored
  })
  assert.equal(bookingRes.status, 201, JSON.stringify(bookingRes.body))
  assert.equal(bookingRes.body.total_price_kobo, 500000, 'server must compute price from listing, ignoring client-supplied total_price_kobo')
  // request-mode listings start at 'held' (awaiting explicit provider
  // confirm/decline before payment); only instant-mode listings start at
  // 'pending_payment' — see the dedicated instant-mode test below.
  assert.equal(bookingRes.body.status, 'held')
  assert.equal(bookingRes.body.payment_status, 'unpaid')
})

test('booking creation: instant-mode listing starts the booking at "pending_payment"', async () => {
  const { client } = await registerUser('create_instant')
  const { listingId, resourceId } = await createTestListing(client, { basePriceKobo: 500000, bookingMode: 'instant' })
  const { startsAt, endsAt } = nextFreshWindow(1)

  const holdRes = await client.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201)

  const bookingRes = await client.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201, JSON.stringify(bookingRes.body))
  assert.equal(bookingRes.body.status, 'pending_payment', 'instant-mode listings must skip straight to pending_payment, no provider acceptance step required')
})

test('booking creation: per_night pricing multiplies base price by number of nights', async () => {
  const { client } = await registerUser('create_night')
  const { listingId, resourceId } = await createTestListing(client, { basePriceKobo: 1000000 })
  // Override pricing_unit to per_night via PATCH is not exposed; instead create
  // a fresh listing directly with pricing_unit request field.
  const res = await client.post('/api/booking-providers/me/bookable-listings', {
    listingType: 'stay_unit',
    title: `Harness Night Listing ${Date.now()}`,
    countryIso: 'NG',
    basePriceKobo: 1000000,
    pricingUnit: 'per_night',
    bookingMode: 'instant',
    resources: [{ name: 'Room', capacityUnits: 1 }],
  })
  assert.equal(res.status, 201)
  const detail = await client.get(`/api/bookable-listings/${res.body.id}`)
  const nightResourceId = detail.body.resources[0].id

  const start = new Date(Date.now() + 60 * 24 * 3600_000)
  const end = new Date(start.getTime() + 3 * 24 * 3600_000) // 3 nights
  const holdRes = await client.post('/api/booking-holds', {
    listing_id: res.body.id,
    resource_id: nightResourceId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
  })
  assert.equal(holdRes.status, 201, JSON.stringify(holdRes.body))

  const bookingRes = await client.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201, JSON.stringify(bookingRes.body))
  assert.equal(bookingRes.body.total_price_kobo, 3000000, '3 nights * 1,000,000 kobo/night must equal 3,000,000 kobo')
})

test('booking creation: malformed request body returns a clean 400, not a raw driver error', async () => {
  const { client } = await registerUser('create_malformed')

  const res1 = await client.request('POST', '/api/booking-holds', { body: 'not json' })
  assert.equal(res1.status, 400)
  assert.ok(!/D1_TYPE_ERROR|SQLITE|undefined.*not supported/i.test(res1.raw), `raw driver error leaked: ${res1.raw}`)

  const res2 = await client.post('/api/booking-holds', {})
  assert.equal(res2.status, 400)
  assert.ok(!/D1_TYPE_ERROR|SQLITE/i.test(res2.raw), `raw driver error leaked: ${res2.raw}`)
  assert.match(res2.body.error, /listing_id/i)
})

test('booking creation: converting a hold that does not belong to the caller is rejected', async () => {
  const { client: ownerClient } = await registerUser('create_owner')
  const { client: attackerClient } = await registerUser('create_attacker')
  const { listingId, resourceId } = await createTestListing(ownerClient)
  const { startsAt, endsAt } = nextFreshWindow(2)

  const holdRes = await ownerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201)

  const stealRes = await attackerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(stealRes.status, 404, 'a hold must not be convertible by anyone other than the customer who created it')
})
