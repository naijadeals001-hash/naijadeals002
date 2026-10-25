import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const indexSource = fs.readFileSync(path.join(root, 'src/index.tsx'), 'utf8')
const migrationSource = fs.readFileSync(path.join(root, 'migrations/0084_full_ecosystem_preview_registry.sql'), 'utf8')
const rolloutMigrationSource = fs.readFileSync(path.join(root, 'migrations/0085_pan_africa_rollout_controls.sql'), 'utf8')
const registrySource = fs.readFileSync(path.join(root, 'src/lib/control-center-ecosystem.ts'), 'utf8')
const controlCenterApiSource = fs.readFileSync(path.join(root, 'src/routes/api-control-center.ts'), 'utf8')

const requiredRoutes = [
  ['/fresh', 'fresh'],
  ['/eats', 'eats'],
  ['/drive', 'drive'],
  ['/send', 'send'],
  ['/stream', 'stream'],
  ['/aura', 'aura'],
  ['/auto', 'auto'],
  ['/homes', 'homes'],
  ['/travel', 'travel'],
  ['/events', 'events'],
  ['/learn', 'learn'],
  ['/jobs', 'jobs'],
  ['/health', 'health'],
  ['/farm', 'farm'],
  ['/home', 'home'],
  ['/beauty', 'beauty'],
]

test('central registry contains the complete required vertical set', () => {
  for (const name of ['NaijaShop', 'NaijaFresh', 'NaijaEats', 'NaijaDrive', 'NaijaGigs', 'NaijaStay', 'NaijaSend', 'NaijaPay', 'NaijaAuto', 'NaijaHomes', 'NaijaTravel', 'NaijaEvents', 'NaijaLearn', 'NaijaJobs', 'NaijaHealth', 'NaijaFarm', 'NaijaStream', 'NaijaHome', 'NaijaBeauty', 'Aura AI']) {
    assert.match(registrySource, new RegExp(name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')))
  }
})

test('all reserved public preview routes are registered through the shared handler', () => {
  for (const [route] of requiredRoutes) {
    assert.match(indexSource, new RegExp(`app\\.get\\('${route.replace('/', '\\/')}'`), `missing route ${route}`)
  }
})

test('full ecosystem migration keeps non-live verticals honest', () => {
  for (const slug of ['pay', 'auto', 'homes', 'travel', 'events', 'learn', 'jobs', 'health', 'farm', 'home', 'beauty']) {
    assert.match(migrationSource, new RegExp(`'${slug}'`))
  }
  assert.match(migrationSource, /status, cta_label/)
  assert.match(migrationSource, /'coming_soon'/)
  assert.doesNotMatch(migrationSource, /INSERT INTO .*orders/i)
  assert.doesNotMatch(migrationSource, /INSERT INTO .*payment_transactions/i)
})

test('Pan-African rollout controls reuse the country and capability engines', () => {
  assert.match(rolloutMigrationSource, /cc_capability_country_overrides/)
  assert.match(rolloutMigrationSource, /country_toggle/)
  assert.match(rolloutMigrationSource, /ecosystem\.naijashop/)
  assert.match(rolloutMigrationSource, /ecosystem\.naijabeauty/)
  assert.match(controlCenterApiSource, /\/rollout\/countries/)
  assert.match(controlCenterApiSource, /country\.status\.manage/)
  assert.match(controlCenterApiSource, /configuration\.write/)
  assert.match(controlCenterApiSource, /vertical_country_override_changed/)
})
