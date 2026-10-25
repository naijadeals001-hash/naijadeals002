import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'playwright'

const baseURL = process.env.NAIJADEALS_PREVIEW_URL || 'http://localhost:3000'

test('NaijaStay host listing operations enforce ownership and expose availability controls', async () => {
  const host = await request.newContext({ baseURL })
  const stranger = await request.newContext({ baseURL })
  const stamp = Date.now()
  try {
    for (const [context, label] of [[host, 'Host'], [stranger, 'Stranger']]) {
      const register = await context.post('/api/auth/register', { data: { name: `NaijaStay ${label}`, email: `naijastay-host-${label.toLowerCase()}-${stamp}@naijadeals.test`, password: 'Stay-QA-2026!' } })
      assert.ok([200, 201].includes(register.status()))
    }

    const create = await host.post('/api/booking-providers/me/bookable-listings', {
      data: {
        listingType: 'stay_unit', title: `QA Palm Suite ${stamp}`, description: 'Synthetic local host QA listing.',
        countryIso: 'NG', city: 'Lagos', bookingMode: 'request', pricingUnit: 'per_night',
        basePriceKobo: 500000, currency: 'NGN', vertical: 'ecosystem.naijastay',
        capacityModel: 'pooled', resources: [{ name: 'Suite pool', resourceType: 'pooled', capacityUnits: 2 }]
      }
    })
    assert.equal(create.status(), 201)
    const listingId = (await create.json()).id
    assert.ok(listingId)

    const owned = await host.get(`/api/booking-providers/me/bookable-listings/${listingId}`)
    assert.equal(owned.status(), 200)
    const ownedBody = await owned.json()
    assert.equal(ownedBody.listing.title, `QA Palm Suite ${stamp}`)
    assert.equal(ownedBody.resources.length, 1)
    const resourceId = ownedBody.resources[0].id

    const strangerRead = await stranger.get(`/api/booking-providers/me/bookable-listings/${listingId}`)
    assert.equal(strangerRead.status(), 404)
    const strangerPatch = await stranger.patch(`/api/booking-providers/me/bookable-listings/${listingId}`, { data: { title: 'Unauthorized rename' } })
    assert.equal(strangerPatch.status(), 404)

    const patch = await host.patch(`/api/booking-providers/me/bookable-listings/${listingId}`, { data: { title: `QA Palm Suite Updated ${stamp}` } })
    assert.equal(patch.status(), 200)
    const block = await host.post(`/api/booking-providers/me/bookable-listings/${listingId}/availability-blocks`, {
      data: { resource_id: resourceId, blocked_from: '2027-03-01T00:00:00Z', blocked_until: '2027-03-03T00:00:00Z', reason: 'maintenance' }
    })
    assert.equal(block.status(), 201)
    const blocks = await host.get(`/api/booking-providers/me/bookable-listings/${listingId}/availability-blocks`)
    assert.equal(blocks.status(), 200)
    assert.equal((await blocks.json()).length, 1)

    const invalidRule = await host.post(`/api/booking-providers/me/bookable-listings/${listingId}/resources/${resourceId}/availability-rules`, { data: { day_of_week: 7, start_time: '09:00', end_time: '17:00' } })
    assert.equal(invalidRule.status(), 400)
  } finally {
    await host.dispose()
    await stranger.dispose()
  }
})
