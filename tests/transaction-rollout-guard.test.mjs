import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const guard = fs.readFileSync(path.join(root, 'src/lib/control-center-rollout.ts'), 'utf8')
const serviceApi = fs.readFileSync(path.join(root, 'src/routes/api-service-requests.ts'), 'utf8')
const providerApi = fs.readFileSync(path.join(root, 'src/routes/api-provider.ts'), 'utf8')
const orderApi = fs.readFileSync(path.join(root, 'src/routes/api-orders.ts'), 'utf8')
const eatsApi = fs.readFileSync(path.join(root, 'src/routes/api-eats.ts'), 'utf8')
const bookingsApi = fs.readFileSync(path.join(root, 'src/routes/api-bookings.ts'), 'utf8')
const logisticsApi = fs.readFileSync(path.join(root, 'src/routes/api-logistics.ts'), 'utf8')
const serviceOrders = fs.readFileSync(path.join(root, 'src/lib/service-orders.ts'), 'utf8')

test('transaction guard fails closed and gives global disablement precedence', () => {
  assert.match(guard, /class RolloutGuardError/)
  assert.match(guard, /if \(row\.globally_enabled !== 1\)/)
  assert.match(guard, /if \(row\.capability_status !== 'ACTIVE'\)/)
  assert.match(guard, /if \(!row\.country_status/)
  assert.match(guard, /if \(row\.country_override === 0\)/)
  assert.match(guard, /VERTICAL_NOT_CONFIGURED/)
  assert.match(guard, /VERTICAL_DISABLED_IN_COUNTRY/)
})

test('transaction boundaries use the shared rollout guard', () => {
  for (const [name, source] of Object.entries({ serviceApi, providerApi, orderApi, eatsApi, bookingsApi, logisticsApi })) {
    assert.match(source, /assertVerticalTransactionAllowed/, `${name} missing rollout guard`)
  }
})

test('service completion confirmation does not fabricate payment settlement', () => {
  assert.match(serviceOrders, /payment_status[\s\S]*remain 'unpaid'/)
  assert.doesNotMatch(serviceOrders, /extra\.push\(`payment_status = 'released'`\)/)
})
