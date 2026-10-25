import assert from 'node:assert/strict'
import test from 'node:test'
import { getTestDb, disposeTestDb } from './payment-engine/helpers/db.mjs'
import { getUnifiedEcosystemRegistry } from '../src/lib/control-center-ecosystem.ts'

test.after(async () => { await disposeTestDb() })

test('authoritative registry exposes independent status dimensions for every configured vertical', async () => {
  const registry = await getUnifiedEcosystemRegistry(await getTestDb())
  assert.ok(registry.length >= 20)
  const drive = registry.find((item) => item.key === 'drive')
  assert.ok(drive)
  assert.equal(drive.implementationState, 'partial')
  assert.equal(drive.enablementState, 'disabled')
  assert.equal(drive.releaseState, 'preview_verified')
  assert.equal(drive.operationsState, 'degraded')
  assert.ok(drive.outstandingAcceptance.includes('GPS'))
  assert.ok(drive.totalCountryCount >= drive.liveCountryCount)
})

test('registry does not equate enablement with operational readiness', async () => {
  const registry = await getUnifiedEcosystemRegistry(await getTestDb())
  const eats = registry.find((item) => item.key === 'eats')
  assert.ok(eats)
  assert.equal(eats.enablementState, 'enabled')
  assert.equal(eats.implementationState, 'partial')
  assert.equal(eats.releaseState, 'preview_verified')
  assert.notEqual(eats.operationsState, 'healthy')
})
