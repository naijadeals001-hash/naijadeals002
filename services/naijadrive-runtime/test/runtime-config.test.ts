import test from 'node:test'
import assert from 'node:assert/strict'
import { loadRuntimeConfig } from '../src/config/runtime-config.js'

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
  NAIJADEAL_IDENTITY_URL: 'https://identity.example.test/',
  NAIJADEAL_IDENTITY_SERVICE_TOKEN: 'development-token',
}

test('loads and normalizes a valid runtime configuration', () => {
  const config = loadRuntimeConfig({ ...baseEnv, PORT: '3200' })
  assert.equal(config.port, 3200)
  assert.equal(config.naijaDealIdentityUrl, 'https://identity.example.test')
  assert.equal(config.pgPoolMax, 10)
})

test('fails closed when required infrastructure configuration is missing', () => {
  for (const key of Object.keys(baseEnv)) {
    const env = { ...baseEnv }
    delete env[key as keyof typeof env]
    assert.throws(() => loadRuntimeConfig(env), new RegExp(`Missing required environment variable: ${key}`))
  }
})

test('rejects invalid ports and pool settings', () => {
  assert.throws(() => loadRuntimeConfig({ ...baseEnv, PORT: '0' }), /PORT must be an integer/)
  assert.throws(() => loadRuntimeConfig({ ...baseEnv, PORT: '65536' }), /PORT must be an integer/)
  assert.throws(() => loadRuntimeConfig({ ...baseEnv, NAIJADRIVE_PG_POOL_MAX: '1.5' }), /NAIJADRIVE_PG_POOL_MAX must be an integer/)
  assert.throws(() => loadRuntimeConfig({ ...baseEnv, NAIJADRIVE_PG_STATEMENT_TIMEOUT_MS: '99' }), /NAIJADRIVE_PG_STATEMENT_TIMEOUT_MS must be an integer/)
})
