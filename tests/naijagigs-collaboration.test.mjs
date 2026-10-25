import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'playwright'

const baseURL = process.env.NAIJADEALS_PREVIEW_URL || 'http://localhost:3000'
const providerEmail = 'demo_gigs_cleaner@naijadeals.demo'
const providerPassword = 'Demo-NaijaGigs-2026!'
const categoryId = 122
const listingId = 3

async function register(context, label, stamp) {
  const response = await context.post('/api/auth/register', {
    data: { name: `NaijaGigs ${label}`, email: `naijagigs-collab-${label.toLowerCase()}-${stamp}@naijadeals.test`, password: 'Collab-QA-2026!' }
  })
  assert.ok([200, 201].includes(response.status()), `registration failed: ${response.status()}`)
}

async function createOrder(customer, provider, stamp) {
  const createRequest = await customer.post('/api/service-requests', {
    data: {
      category_id: categoryId,
      service_listing_id: listingId,
      title: `NaijaGigs collaboration QA ${stamp}`,
      description: 'Synthetic local QA request. No real customer or provider activity.',
      country_iso: 'NG', city: 'Lagos', address_line1: 'Victoria Island',
      budget_kobo: 2500000, urgency: 'normal'
    }
  })
  assert.equal(createRequest.status(), 201)
  const requestId = (await createRequest.json()).id

  const quote = await provider.post(`/api/providers/me/requests/${requestId}/quotes`, {
    data: { price_kobo: 1800000, currency: 'NGN', estimated_duration_minutes: 120,
      scope: 'Deep clean two-bedroom apartment', expires_at: new Date(Date.now() + 3600000).toISOString() }
  })
  assert.equal(quote.status(), 201)
  const quoteId = (await quote.json()).id
  const accept = await customer.post(`/api/quotes/${quoteId}/accept`)
  assert.equal(accept.status(), 200)
  return (await accept.json()).service_order_id
}

test('NaijaGigs collaboration enforces participant ownership, state transitions, persistence, idempotency, and no payment side effects', async () => {
  const customer = await request.newContext({ baseURL })
  const provider = await request.newContext({ baseURL })
  const stranger = await request.newContext({ baseURL })
  const stamp = Date.now()

  try {
    await register(customer, 'Customer', stamp)
    await register(stranger, 'Stranger', stamp)
    const providerLogin = await provider.post('/api/auth/login', { data: { identifier: providerEmail, password: providerPassword } })
    assert.equal(providerLogin.status(), 200)
    const orderId = await createOrder(customer, provider, stamp)

    const empty = await customer.get(`/api/service-orders/${orderId}/collaboration`)
    assert.equal(empty.status(), 200)
    assert.deepEqual(await empty.json(), { milestones: [], messages: [] })

    const strangerRead = await stranger.get(`/api/service-orders/${orderId}/collaboration`)
    assert.equal(strangerRead.status(), 404)

    const customerMilestone = await customer.post(`/api/service-orders/${orderId}/milestones`, {
      data: { title: 'Customer cannot create this' }
    })
    assert.equal(customerMilestone.status(), 403)

    const invalidMessage = await customer.post(`/api/service-orders/${orderId}/messages`, { data: { body: '   ' } })
    assert.equal(invalidMessage.status(), 400)

    const milestone = await provider.post(`/api/service-orders/${orderId}/milestones`, {
      headers: { 'Idempotency-Key': 'milestone-1' },
      data: { title: 'Initial site work', description: 'Complete the first work package.' }
    })
    assert.equal(milestone.status(), 201)
    const milestoneBody = await milestone.json()
    const milestoneId = milestoneBody.milestone.id
    assert.equal(milestoneBody.milestone.status, 'pending')

    const duplicateMilestone = await provider.post(`/api/service-orders/${orderId}/milestones`, {
      headers: { 'Idempotency-Key': 'milestone-1' },
      data: { title: 'Should not duplicate' }
    })
    assert.equal(duplicateMilestone.status(), 201)
    assert.equal((await duplicateMilestone.json()).milestone.id, milestoneId)

    const providerStart = await provider.post(`/api/service-orders/${orderId}/milestones/${milestoneId}/transition`, { data: { status: 'in_progress' } })
    assert.equal(providerStart.status(), 200)
    const invalidCustomerStart = await customer.post(`/api/service-orders/${orderId}/milestones/${milestoneId}/transition`, { data: { status: 'in_progress' } })
    assert.equal(invalidCustomerStart.status(), 400)
    const providerSubmit = await provider.post(`/api/service-orders/${orderId}/milestones/${milestoneId}/transition`, { data: { status: 'submitted' } })
    assert.equal(providerSubmit.status(), 200)
    const invalidProviderApprove = await provider.post(`/api/service-orders/${orderId}/milestones/${milestoneId}/transition`, { data: { status: 'approved' } })
    assert.equal(invalidProviderApprove.status(), 400)
    const customerApprove = await customer.post(`/api/service-orders/${orderId}/milestones/${milestoneId}/transition`, { data: { status: 'approved' } })
    assert.equal(customerApprove.status(), 200)
    const invalidAfterApproval = await customer.post(`/api/service-orders/${orderId}/milestones/${milestoneId}/transition`, { data: { status: 'rejected' } })
    assert.equal(invalidAfterApproval.status(), 400)

    const customerMessage = await customer.post(`/api/service-orders/${orderId}/messages`, {
      headers: { 'Idempotency-Key': 'message-1' }, data: { body: 'Please confirm the completed work package.' }
    })
    assert.equal(customerMessage.status(), 201)
    const duplicateMessage = await customer.post(`/api/service-orders/${orderId}/messages`, {
      headers: { 'Idempotency-Key': 'message-1' }, data: { body: 'This retry must not create another message.' }
    })
    assert.equal(duplicateMessage.status(), 201)
    assert.equal((await duplicateMessage.json()).message.id, (await customerMessage.json()).message.id)
    const providerMessage = await provider.post(`/api/service-orders/${orderId}/messages`, { data: { body: 'Work package approved and recorded.' } })
    assert.equal(providerMessage.status(), 201)
    const strangerMessage = await stranger.post(`/api/service-orders/${orderId}/messages`, { data: { body: 'Unauthorized message' } })
    assert.equal(strangerMessage.status(), 404)

    const fresh = await customer.get(`/api/service-orders/${orderId}/collaboration`)
    assert.equal(fresh.status(), 200)
    const collaboration = await fresh.json()
    assert.equal(collaboration.milestones.length, 1)
    assert.equal(collaboration.milestones[0].status, 'approved')
    assert.equal(collaboration.messages.length, 2)
    assert.ok(collaboration.messages.some((message) => message.body.includes('completed work')))

    const order = await customer.get(`/api/service-orders/${orderId}`)
    assert.equal(order.status(), 200)
    const orderBody = await order.json()
    assert.equal(orderBody.order.payment_status, 'unpaid')
    assert.ok(orderBody.events.some((event) => JSON.parse(event.metadata_json || '{}').action === 'milestone_created'))
    assert.ok(orderBody.events.some((event) => JSON.parse(event.metadata_json || '{}').action === 'milestone_transition'))
    assert.ok(orderBody.events.some((event) => JSON.parse(event.metadata_json || '{}').action === 'message_created'))
  } finally {
    await customer.dispose()
    await provider.dispose()
    await stranger.dispose()
  }
})
