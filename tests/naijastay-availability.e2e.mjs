import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'playwright'

const baseURL = process.env.NAIJADEALS_PREVIEW_URL || 'http://localhost:3000'

test('NaijaStay exposes real listing discovery and validates availability windows', async () => {
  const api = await request.newContext({ baseURL })
  try {
    const home = await api.get('/stay')
    assert.equal(home.status(), 200)
    const property = await api.get('/stay/property/demo-lagos-palm-hotel')
    assert.equal(property.status(), 200)

    const available = await api.get('/api/bookable-listings/1/availability?resource_id=1&starts_at=2027-02-10T14:00:00Z&ends_at=2027-02-12T11:00:00Z&capacity=1')
    assert.equal(available.status(), 200)
    assert.equal((await available.json()).available, true)

    const invalid = await api.get('/api/bookable-listings/1/availability?resource_id=1&starts_at=not-a-date&ends_at=2027-02-12T11:00:00Z')
    assert.equal(invalid.status(), 400)
  } finally {
    await api.dispose()
  }
})
