export interface RuntimeConfig {
  port: number
  databaseUrl: string
  redisUrl: string
  naijaDealIdentityUrl: string
  naijaDealServiceToken: string
  pgPoolMax: number
  pgStatementTimeoutMs: number
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const required = (key: string): string => {
    const value = env[key]?.trim()
    if (!value) throw new Error(`Missing required environment variable: ${key}`)
    return value
  }

  const pgPoolMax = Number(env.NAIJADRIVE_PG_POOL_MAX ?? 10)
  const pgStatementTimeoutMs = Number(env.NAIJADRIVE_PG_STATEMENT_TIMEOUT_MS ?? 5000)
  if (!Number.isInteger(pgPoolMax) || pgPoolMax < 1 || pgPoolMax > 100) throw new Error('NAIJADRIVE_PG_POOL_MAX must be an integer between 1 and 100')
  if (!Number.isInteger(pgStatementTimeoutMs) || pgStatementTimeoutMs < 100 || pgStatementTimeoutMs > 120000) throw new Error('NAIJADRIVE_PG_STATEMENT_TIMEOUT_MS is invalid')

  return {
    port: Number(env.PORT ?? 3100),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    naijaDealIdentityUrl: required('NAIJADEAL_IDENTITY_URL').replace(/\/$/, ''),
    naijaDealServiceToken: required('NAIJADEAL_IDENTITY_SERVICE_TOKEN'),
    pgPoolMax,
    pgStatementTimeoutMs,
  }
}
