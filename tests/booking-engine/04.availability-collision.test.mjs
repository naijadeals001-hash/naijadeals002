/**
 * Invariant #4: availability collision (Area D of the 57-check gate).
 *
 * Covers: available slot, overlapping window rejection, boundary
 * (touching, non-overlapping) windows correctly treated as available,
 * and provider-created blackout blocks correctly making a window
 * unavailable.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, createTestListing, nextFreshWindow } from './helpers/client.mjs'

test('availability: a fresh window on a fresh single-capacity resource is available', async () => {
  const { client: provider } = await registerUser('avail_prov1')
  const { listingId, resourceId } = await createTestListing(provider)
  const { startsAt, endsAt } = nextFreshWindow(1)

  const res = await provider.get(`/api/bookable-listings/${listingId}/availability?resource_id=${resourceId}&starts_at=${startsAt}&ends_at=${endsAt}&capacity=1`)
  assert.equal(res.status, 200)
  assert.equal(res.body.available, true)
  assert.equal(res.body.remainingCapacity, 1)
})

test('availability: an overlapping window on a capacity=1 resource is rejected at hold-creation time', async () => {
  const { client: provider } = await registerUser('avail_prov2')
  const { client: custA } = await registerUser('avail_custA2')
  const { client: custB } = await registerUser('avail_custB2')
  const { listingId, resourceId } = await createTestListing(provider)
  const { startsAt, endsAt } = nextFreshWindow(2, 2) // 2-hour window

  const holdA = await custA.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdA.status, 201)

  // Overlapping window: starts 1 hour into A's window.
  const overlapStart = new Date(new Date(startsAt).getTime() + 3600_000).toISOString()
  const overlapEnd = new Date(new Date(endsAt).getTime() + 3600_000).toISOString()
  const holdB = await custB.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: overlapStart, ends_at: overlapEnd })
  assert.equal(holdB.status, 409, 'an overlapping window on a fully-consumed capacity=1 resource must be rejected')
})

test('availability: a boundary-adjacent (touching, non-overlapping) window remains available', async () => {
  const { client: provider } = await registerUser('avail_prov3')
  const { client: custA } = await registerUser('avail_custA3')
  const { client: custB } = await registerUser('avail_custB3')
  const { listingId, resourceId } = await createTestListing(provider)
  const { startsAt, endsAt } = nextFreshWindow(3, 1)

  const holdA = await custA.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdA.status, 201)

  // Adjacent window starting exactly when A's ends — must NOT be treated as overlapping.
  const adjacentEnd = new Date(new Date(endsAt).getTime() + 3600_000).toISOString()
  const checkRes = await custB.get(`/api/bookable-listings/${listingId}/availability?resource_id=${resourceId}&starts_at=${endsAt}&ends_at=${adjacentEnd}&capacity=1`)
  assert.equal(checkRes.status, 200)
  assert.equal(checkRes.body.available, true, 'a window starting exactly when the previous one ends must be considered available (half-open interval semantics)')
});

test('availability: a provider-created blackout block makes the window unavailable', async () => {
  const { client: provider } = await registerUser('avail_prov4')
  const { listingId, resourceId } = await createTestListing(provider)
  const { startsAt, endsAt } = nextFreshWindow(10, 24)

  const blockRes = await provider.post(`/api/booking-providers/me/bookable-listings/${listingId}/availability-blocks`, {
    resource_id: resourceId,
    blocked_from: startsAt,
    blocked_until: endsAt,
    reason: 'maintenance',
  })
  assert.equal(blockRes.status, 201)

  const checkRes = await provider.get(`/api/bookable-listings/${listingId}/availability?resource_id=${resourceId}&starts_at=${startsAt}&ends_at=${endsAt}&capacity=1`)
  assert.equal(checkRes.status, 200)
  assert.equal(checkRes.body.available, false)
  assert.equal(checkRes.body.reason, 'blocked')
});

test('availability: N-capacity resource allows exactly N concurrent non-overlapping holds and rejects the (N+1)th', async () => {
  const { client: provider } = await registerUser('avail_prov5')
  const { listingId, resourceId } = await createTestListing(provider, { capacityUnits: 3 })
  const { startsAt, endsAt } = nextFreshWindow(4, 1)

  const customers = await Promise.all([registerUser('avail_c1'), registerUser('avail_c2'), registerUser('avail_c3'), registerUser('avail_c4')])
  const results = []
  for (const { client } of customers) {
    const r = await client.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt, capacity_requested: 1 })
    results.push(r.status)
  }
  const successCount = results.filter((s) => s === 201).length
  const rejectedCount = results.filter((s) => s === 409).length
  assert.equal(successCount, 3, `expected exactly 3 successful holds for a capacity=3 resource, got statuses: ${results}`)
  assert.equal(rejectedCount, 1, `expected exactly 1 rejected (4th) hold, got statuses: ${results}`)
});
