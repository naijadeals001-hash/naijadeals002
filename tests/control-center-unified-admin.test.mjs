import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { UNIFIED_ECOSYSTEM_VERTICALS, hasUnifiedVertical } from '../src/lib/control-center-ecosystem.ts'

const root = new URL('../', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')

test('unified registry contains every required vertical exactly once', () => {
  const required = [
    'NaijaShop', 'NaijaFresh', 'NaijaEats', 'NaijaDrive', 'NaijaGigs', 'NaijaStay',
    'NaijaSend', 'NaijaPay', 'NaijaAuto', 'NaijaHomes', 'NaijaTravel', 'NaijaEvents',
    'NaijaLearn', 'NaijaJobs', 'NaijaHealth', 'NaijaFarm', 'NaijaStream', 'NaijaHome',
    'NaijaBeauty', 'Aura AI',
  ]
  assert.equal(new Set(UNIFIED_ECOSYSTEM_VERTICALS.map((vertical) => vertical.name)).size, required.length)
  for (const name of required) assert.ok(UNIFIED_ECOSYSTEM_VERTICALS.some((vertical) => vertical.name === name), name)
  assert.equal(hasUnifiedVertical('drive'), true)
  assert.equal(hasUnifiedVertical('not-a-vertical'), false)
})

test('registry does not overclaim unavailable or incomplete verticals', () => {
  const drive = UNIFIED_ECOSYSTEM_VERTICALS.find((vertical) => vertical.key === 'drive')
  const send = UNIFIED_ECOSYSTEM_VERTICALS.find((vertical) => vertical.key === 'send')
  const aura = UNIFIED_ECOSYSTEM_VERTICALS.find((vertical) => vertical.key === 'aura')
  assert.equal(drive.capabilityState, 'incomplete')
  assert.match(drive.evidence, /routing|booking|dispatch/i)
  assert.equal(send.capabilityState, 'unavailable')
  assert.equal(aura.capabilityState, 'incomplete')
})

test('Control Center uses one shared session/RBAC/audit boundary', () => {
  const rbac = read('src/lib/control-center-rbac.ts')
  const api = read('src/routes/api-control-center.ts')
  const layout = read('src/components/ControlCenterLayout.tsx')
  assert.match(rbac, /get\('user'\)/)
  assert.match(rbac, /resolveControlCenterAccess\(c\.env\.DB, user\.id\)/)
  assert.match(rbac, /Missing required Control Center permission/)
  assert.match(api, /requireControlCenterApiAuth/)
  assert.match(api, /getUnifiedEcosystemRegistry/)
  assert.match(layout, /ccAccess\.permissionKeys\.has\(item\.permission\)/)
  assert.match(layout, /NAV_GROUPS/)
})

test('central navigation exposes shared entity, finance, audit, and ecosystem surfaces', () => {
  const layout = read('src/components/ControlCenterLayout.tsx')
  for (const label of ['Command Center', 'Audit & Governance', 'Customers', 'Vendors & Stores', 'Providers & Partners', 'NaijaDeals Ecosystem', 'Payments & Finance']) {
    assert.match(layout, new RegExp(label.replace(/[&]/g, '\\&')))
  }
  assert.match(layout, /permission\?: string/)
  assert.match(layout, /implemented: boolean/)
})

test('public NaijaDrive surface does not embed or prominently expose Control Center', () => {
  const drive = read('src/pages/drive.tsx')
  assert.doesNotMatch(drive, /href="#operations"/)
  assert.doesNotMatch(drive, /NaijaDeal Control Center/)
  assert.match(drive, /NaijaDrive private ride preview/)
})

test('admin hostname preparation preserves the existing protected path entry point', () => {
  const host = read('src/lib/admin-host.ts')
  const index = read('src/index.tsx')
  assert.match(host, /admin\.naijadeals\.com/)
  assert.match(host, /\/control-center\/login/)
  assert.match(index, /isCanonicalAdminHost/)
  assert.match(index, /ADMIN_PATH_ENTRY/)
  assert.match(index, /c\.req\.path === '\/'/)
})

test('legacy admin compatibility routes use the canonical Control Center boundary', () => {
  const legacy = read('src/routes/api-admin.ts')
  const unified = read('src/routes/api-control-center.ts')
  assert.match(legacy, /requireControlCenterApiAuth/)
  assert.doesNotMatch(legacy, /requirePlatformRole\('admin'\)/)
  assert.match(legacy, /requireControlCenterPermission\('moderation\.read'\)/)
  assert.match(legacy, /requireControlCenterPermission\('moderation\.manage'\)/)
  assert.match(legacy, /requireControlCenterPermission\('notifications\.manage'\)/)
  assert.match(legacy, /requireControlCenterPermission\('customers\.suspend'\)/)
  assert.match(legacy, /recordControlCenterAction/)
  assert.match(unified, /requireControlCenterApiAuth/)
  assert.match(unified, /cc_user_roles|Control Center/i)
})
