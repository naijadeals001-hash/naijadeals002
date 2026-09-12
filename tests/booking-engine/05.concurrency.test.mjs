/**
 * Invariant #5: concurrency — CRITICAL (Area C of the 57-check gate).
 *
 * Genuine concurrent requests via Promise.all (real parallel HTTP calls
 * against the live local D1-backed dev server), NOT sequential simulation.
 * Proves the atomic INSERT...SELECT...WHERE pattern in booking-holds.ts is
 * race-safe: exactly one winner, all others rejected, zero over-allocation.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, createTestListing, nextFreshWindow } from './helpers/client.mjs'
import { queryOneD1 } from './helpers/d1.mjs'

test('concurrency: 2-way race for a single capacity=1 slot yields exactly one 201 and one 409', async () => {
  const { client: provider } = await registerUser('conc_prov1')
  const { client: custA } = await registerUser('conc_custA1')
  const { client: custB } = await registerUser('conc_custB1')
  const { listingId, resourceId } = await createTestListing(provider)
  const { startsAt, endsAt } = nextFreshWindow(20)

  const [resA, resB] = await Promise.all([
    custA.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt }),
    custB.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt }),
  ])
  const statuses = [resA.status, resB.status].sort()
  assert.deepEqual(statuses, [201, 409], `expected exactly one winner (201) and one loser (409), got: ${resA.status}, ${resB.status}`)
});

test('concurrency: 8-way race for a single capacity=1 slot yields exactly one winner, seven losers', async () => {
  const { client: provider } = await registerUser('conc_prov2')
  const { listingId, resourceId } = await createTestListing(provider)
  const { startsAt, endsAt } = nextFreshWindow(21)

  const racers = await Promise.all(Array.from({ length: 8 }, (_, i) => registerUser(`conc_racer2_${i}`)))
  const results = await Promise.all(
    racers.map(({ client }) => client.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt }))
  );
  const statuses = results.map((r) => r.status)
  const wins = statuses.filter((s) => s === 201).length
  const losses = statuses.filter((s) => s === 409).length
  assert.equal(wins, 1, `expected exactly 1 winner in an 8-way race, got statuses: ${statuses}`)
  assert.equal(losses, 7, `expected exactly 7 losers in an 8-way race, got statuses: ${statuses}`)

  // Ground-truth check directly in D1: exactly one active hold for this window.
  const row = await queryOneD1(`SELECT COUNT(*) as n FROM booking_holds WHERE resource_id = ${resourceId} AND status = 'active' AND starts_at = '${startsAt}'`)
  assert.equal(row.n, 1, 'D1 ground truth must show exactly one active hold for the contested window')
});

test('concurrency: double-conversion race on the SAME hold produces exactly one booking row, never two', async () => {
  const { client: provider } = await registerUser('conc_prov3')
  const { client: customer } = await registerUser('conc_cust3')
  const { listingId, resourceId } = await createTestListing(provider)
  const { startsAt, endsAt } = nextFreshWindow(22)

  const holdRes = await customer.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201)
  const holdId = holdRes.body.id

  const [conv1, conv2] = await Promise.all([
    customer.post('/api/bookings', { hold_id: holdId }),
    customer.post('/api/bookings', { hold_id: holdId }),
  ])
  const statuses = [conv1.status, conv2.status].sort()
  assert.deepEqual(statuses, [201, 409], `expected exactly one successful conversion (201) and one rejected (409), got: ${conv1.status}, ${conv2.status}`)

  const row = await queryOneD1(`SELECT COUNT(*) as n FROM bookings WHERE hold_id = ${holdId}`)
  assert.equal(row.n, 1, 'D1 ground truth must show exactly one booking row for this hold, never two, regardless of the race')
});

test('concurrency: capacity=3 resource under 5-way race allows exactly 3 winners, rejects 2', async () => {
  const { client: provider } = await registerUser('conc_prov4')
  const { listingId, resourceId } = await createTestListing(provider, { capacityUnits: 3 })
  const { startsAt, endsAt } = nextFreshWindow(23)

  const racers = await Promise.all(Array.from({ length: 5 }, (_, i) => registerUser(`conc_racer4_${i}`)))
  const results = await Promise.all(
    racers.map(({ client }) => client.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt }))
  );
  const statuses = results.map((r) => r.status)
  const wins = statuses.filter((s) => s === 201).length
  const losses = statuses.filter((s) => s === 409).length
  assert.equal(wins, 3, `expected exactly 3 winners for a capacity=3 resource under 5-way contention, got: ${statuses}`)
  assert.equal(losses, 2, `expected exactly 2 losers, got: ${statuses}`)

  const row = await queryOneD1(`SELECT COALESCE(SUM(capacity_requested), 0) as total FROM booking_holds WHERE resource_id = ${resourceId} AND status = 'active' AND starts_at = '${startsAt}'`)
  assert.equal(row.total, 3, 'total allocated capacity must never exceed the resource ceiling, even under concurrent contention')
});
