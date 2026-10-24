export interface RuntimeConfig {
  port: number
  databaseUrl: string
  redisUrl: string
  naijaDealIdentityUrl: string
  naijaDealServiceToken: string
  pgPoolMax: number
  pgStatementTimeoutMs: number
}

function integerEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const value = Number(env[key] ?? fallback)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`)
  }
  return value
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const required = (key: string): string => {
    const value = env[key]?.trim()
    if (!value) throw new Error(`Missing required environment variable: ${key}`)
    return value
  }

  return {
    port: integerEnv(env, 'PORT', 3100, 1, 65535),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    naijaDealIdentityUrl: required('NAIJADEAL_IDENTITY_URL').replace(/\/$/, ''),
    naijaDealServiceToken: required('NAIJADEAL_IDENTITY_SERVICE_TOKEN'),
    pgPoolMax: integerEnv(env, 'NAIJADRIVE_PG_POOL_MAX', 10, 1, 100),
    pgStatementTimeoutMs: integerEnv(env, 'NAIJADRIVE_PG_STATEMENT_TIMEOUT_MS', 5000, 100, 120000),
  }
}
