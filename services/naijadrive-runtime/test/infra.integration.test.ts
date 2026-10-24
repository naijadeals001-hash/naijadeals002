import test from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { loadRuntimeConfig } from '../src/config/runtime-config.js'
import { runMigrations } from '../src/infra/migrations.js'
import { RedisPresenceStore } from '../src/infra/redis-presence.js'

const enabled = process.env.RUN_INTEGRATION_TESTS === '1'
const integration = enabled ? test : test.skip
const config = enabled ? loadRuntimeConfig() : null

integration('applies transactional migrations and enables PostGIS', async () => {
  const pool = new Pool({ connectionString: config!.databaseUrl })
  try {
    await runMigrations(pool, new URL('../../migrations/', import.meta.url).pathname)
    const result = await pool.query<{ postgis_version: string; migration_count: string }>(`
      SELECT PostGIS_Version() AS postgis_version,
        (SELECT COUNT(*)::text FROM naijadrive_schema_migrations) AS migration_count
    `)
    assert.match(result.rows[0].postgis_version, /^\d+\.\d+/)
    assert.equal(Number(result.rows[0].migration_count), 2)
  } finally {
    await pool.end()
  }
})

integration('uses Redis NX assignment claims and expires presence', async () => {
  const presence = new RedisPresenceStore(config!)
  try {
    await presence.connect()
    const driverId = 990001
    await presence.heartbeat({
      driverId,
      vehicleId: 1,
      vehicleCategory: 'car',
      zoneKey: 'abuja-central',
      latitude: 9.0579,
      longitude: 7.4951,
      heartbeatAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
    }, 5)
    assert.equal((await presence.get(driverId))?.driverId, driverId)
    const claims = await Promise.all([
      presence.claimAssignment(driverId, 1, 5),
      presence.claimAssignment(driverId, 2, 5),
    ])
    assert.equal(claims.filter(Boolean).length, 1)
    assert.equal(await presence.releaseAssignment(driverId, claims[0] ? 1 : 2), true)
    await new Promise((resolve) => setTimeout(resolve, 5_500))
    assert.equal(await presence.get(driverId), null)
  } finally {
    await presence.close()
  }
})
