import assert from 'node:assert/strict'
import test from 'node:test'
import { getTestDb, createTestUser, disposeTestDb, RUN_NONCE } from './payment-engine/helpers/db.mjs'
import { canManageCountry, resolveControlCenterAccess } from '../src/lib/control-center-rbac.ts'
import { assertVerticalTransactionAllowed, RolloutGuardError } from '../src/lib/control-center-rollout.ts'
import { ensureDevelopmentBacklog, getDevelopmentTask } from '../src/lib/control-center-development.ts'

const createdUsers = []

async function roleUser(db, roleKey, label) {
  const userId = await createTestUser(`cc003_${RUN_NONCE}_${label}`)
  createdUsers.push(userId)
  await db.prepare(`INSERT INTO cc_user_roles(user_id,role_id,assigned_by_user_id) SELECT ?,id,? FROM cc_roles WHERE key=?`).bind(userId, userId, roleKey).run()
  return userId
}

test('CC-003 role matrix resolves server-side permissions without client role claims', async () => {
  const db = await getTestDb()
  const users = {
    superAdmin: await roleUser(db, 'super_admin', 'super'),
    operations: await roleUser(db, 'operations_admin', 'operations'),
    finance: await roleUser(db, 'finance_officer', 'finance'),
    country: await roleUser(db, 'country_admin', 'country'),
    auditor: await roleUser(db, 'auditor', 'auditor'),
  }
  await db.prepare('INSERT INTO cc_user_country_scopes(user_id,country_iso,assigned_by_user_id) VALUES(?,?,?)').bind(users.country, 'NG', users.superAdmin).run()

  const superAccess = await resolveControlCenterAccess(db, users.superAdmin)
  const operationsAccess = await resolveControlCenterAccess(db, users.operations)
  const financeAccess = await resolveControlCenterAccess(db, users.finance)
  const countryAccess = await resolveControlCenterAccess(db, users.country)
  const auditorAccess = await resolveControlCenterAccess(db, users.auditor)

  assert.ok(superAccess.permissionKeys.has('configuration.write'))
  assert.ok(superAccess.permissionKeys.has('configuration.city.manage'))
  assert.ok(operationsAccess.permissionKeys.has('orders.manage'))
  assert.ok(!operationsAccess.permissionKeys.has('configuration.city.manage'))
  assert.ok(financeAccess.permissionKeys.has('refunds.approve'))
  assert.ok(!financeAccess.permissionKeys.has('orders.manage'))
  assert.ok(countryAccess.permissionKeys.has('configuration.city.manage'))
  assert.deepEqual(countryAccess.countryIsoCodes, ['NG'])
  assert.equal(canManageCountry(countryAccess, 'NG'), true)
  assert.equal(canManageCountry(countryAccess, 'GH'), false)
  assert.ok(auditorAccess.permissionKeys.has('audit.read'))
  assert.ok(!auditorAccess.permissionKeys.has('configuration.city.manage'))
})

test('CC-003 city override narrows transaction availability and global disablement wins', async () => {
  const db = await getTestDb()
  const country = await db.prepare("SELECT id,iso_code FROM cc_countries WHERE iso_code='NG'").first()
  assert.ok(country)
  const capability = await db.prepare("SELECT id,key,enabled FROM cc_capabilities WHERE key='ecosystem.naijaeats'").first()
  assert.ok(capability)
  const previousCountry = await db.prepare('SELECT status FROM cc_countries WHERE id=?').bind(country.id).first()
  const previousOverride = await db.prepare('SELECT * FROM cc_vertical_city_overrides WHERE vertical_slug=? AND country_iso=? AND city_name=?').bind('eats','NG','CC003 City').first()
  try {
    await db.prepare("UPDATE cc_countries SET status='LIVE' WHERE id=?").bind(country.id).run()
    await db.prepare('DELETE FROM cc_vertical_city_overrides WHERE vertical_slug=? AND country_iso=? AND city_name=?').bind('eats','NG','CC003 City').run()
    await assert.doesNotReject(() => assertVerticalTransactionAllowed(db, 'ecosystem.naijaeats', 'NG', 'CC003 City'))
    await db.prepare("INSERT INTO cc_vertical_city_overrides(vertical_slug,country_iso,city_name,enablement_state,reason) VALUES('eats','NG','CC003 City','disabled','CC003 test')").run()
    await assert.rejects(() => assertVerticalTransactionAllowed(db, 'ecosystem.naijaeats', 'NG', 'CC003 City'), (error) => error instanceof RolloutGuardError && error.code === 'VERTICAL_DISABLED_IN_CITY')
    await db.prepare("UPDATE cc_capabilities SET enabled=0 WHERE id=?").bind(capability.id).run()
    await assert.rejects(() => assertVerticalTransactionAllowed(db, 'ecosystem.naijaeats', 'NG', 'CC003 City'), (error) => error instanceof RolloutGuardError && error.code === 'VERTICAL_DISABLED')
  } finally {
    if (previousOverride) {
      await db.prepare('INSERT OR REPLACE INTO cc_vertical_city_overrides(id,vertical_slug,country_iso,city_name,enablement_state,reason,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(previousOverride.id, previousOverride.vertical_slug, previousOverride.country_iso, previousOverride.city_name, previousOverride.enablement_state, previousOverride.reason, previousOverride.created_by_user_id, previousOverride.created_at, previousOverride.updated_at).run()
    } else {
      await db.prepare('DELETE FROM cc_vertical_city_overrides WHERE vertical_slug=? AND country_iso=? AND city_name=?').bind('eats','NG','CC003 City').run()
    }
    await db.prepare('UPDATE cc_countries SET status=? WHERE id=?').bind(previousCountry.status, country.id).run()
    await db.prepare('UPDATE cc_capabilities SET enabled=? WHERE id=?').bind(capability.enabled, capability.id).run()
  }
})

test('CC-003 Development Registry seeding is idempotent and has no value-count mismatch', async () => {
  const db = await getTestDb()
  await ensureDevelopmentBacklog(db)
  await ensureDevelopmentBacklog(db)
  const task = await getDevelopmentTask(db, 'CC-003')
  assert.equal(task?.task_key, 'CC-003')
  const count = await db.prepare('SELECT COUNT(*) AS count FROM cc_development_tasks').first()
  assert.ok(Number(count.count) >= 12)
})

test.after(async () => {
  const db = await getTestDb()
  if (createdUsers.length) {
    await db.prepare(`DELETE FROM cc_user_country_scopes WHERE user_id IN (${createdUsers.map(() => '?').join(',')})`).bind(...createdUsers).run()
    await db.prepare(`DELETE FROM cc_user_roles WHERE user_id IN (${createdUsers.map(() => '?').join(',')})`).bind(...createdUsers).run()
    await db.prepare(`DELETE FROM users WHERE id IN (${createdUsers.map(() => '?').join(',')})`).bind(...createdUsers).run()
  }
  await disposeTestDb()
})
