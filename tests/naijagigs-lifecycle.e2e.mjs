import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'playwright'

const baseURL = process.env.NAIJADEALS_PREVIEW_URL || 'http://localhost:3000'
const providerEmail = 'demo_gigs_cleaner@naijadeals.demo'
const providerPassword = 'Demo-NaijaGigs-2026!'
const categoryId = 122
const listingId = 3

test('NaijaGigs customer/provider lifecycle is persisted and authorized', async () => {
  const customer = await request.newContext({ baseURL })
  const provider = await request.newContext({ baseURL })
  const stamp = Date.now()

  try {
    const register = await customer.post('/api/auth/register', {
      data: {
        name: 'NaijaGigs Gate A QA Customer',
        email: `naijagigs-gate-a-${stamp}@naijadeals.test`,
        password: 'GateA-QA-2026!'
      }
    })
    assert.ok([200, 201].includes(register.status()))

    const providerLogin = await provider.post('/api/auth/login', {
      data: { identifier: providerEmail, password: providerPassword }
    })
    assert.equal(providerLogin.status(), 200)

    const createRequest = await customer.post('/api/service-requests', {
      data: {
        category_id: categoryId,
        service_listing_id: listingId,
        title: `NaijaGigs lifecycle QA ${stamp}`,
        description: 'Synthetic local QA request. No real customer or provider activity.',
        country_iso: 'NG',
        city: 'Lagos',
        address_line1: 'Victoria Island',
        budget_kobo: 2500000,
        urgency: 'normal'
      }
    })
    assert.equal(createRequest.status(), 201)
    const requestBody = await createRequest.json()
    const requestId = requestBody.id
    assert.ok(requestId)

    const openRequests = await provider.get('/api/providers/me/requests')
    assert.equal(openRequests.status(), 200)

    const createQuote = await provider.post(`/api/providers/me/requests/${requestId}/quotes`, {
      data: {
        price_kobo: 1800000,
        currency: 'NGN',
        estimated_duration_minutes: 120,
        scope: 'Deep clean two-bedroom apartment',
        expires_at: new Date(Date.now() + 3600000).toISOString()
      }
    })
    assert.equal(createQuote.status(), 201)
    const quoteId = (await createQuote.json()).id
    assert.ok(quoteId)

    const customerRequest = await customer.get(`/api/service-requests/${requestId}`)
    assert.equal(customerRequest.status(), 200)
    assert.equal((await customerRequest.json()).quotes.length, 1)

    const accept = await customer.post(`/api/quotes/${quoteId}/accept`)
    assert.equal(accept.status(), 200)
    const accepted = await accept.json()
    assert.ok(accepted.service_order_id)

    const duplicateAccept = await customer.post(`/api/quotes/${quoteId}/accept`)
    assert.equal(duplicateAccept.status(), 400)

    const providerCannotReadCustomerRequest = await provider.get(`/api/service-requests/${requestId}`)
    assert.equal(providerCannotReadCustomerRequest.status(), 404)

    const orderId = accepted.service_order_id
    for (const status of ['scheduled', 'provider_arriving', 'in_progress']) {
      const transition = await provider.post(`/api/providers/me/orders/${orderId}/transition`, { data: { status } })
      assert.equal(transition.status(), 200)
    }

    const complete = await provider.post(`/api/service-orders/${orderId}/complete`)
    assert.equal(complete.status(), 200)

    const customerConfirm = await customer.post(`/api/service-orders/${orderId}/confirm`)
    assert.equal(customerConfirm.status(), 200)

    const order = await customer.get(`/api/service-orders/${orderId}`)
    assert.equal(order.status(), 200)
    const orderBody = await order.json()
    assert.equal(orderBody.order.status, 'customer_confirmed')
    assert.equal(orderBody.order.payment_status, 'unpaid')
    assert.ok(orderBody.events.length >= 6)
  } finally {
    await customer.dispose()
    await provider.dispose()
  }
})
