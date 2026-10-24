import { Pool, type PoolConfig } from 'pg'
import type { RuntimeConfig } from '../config/runtime-config.js'

export function createPostgresPool(config: RuntimeConfig): Pool {
  const poolConfig: PoolConfig = {
    connectionString: config.databaseUrl,
    max: config.pgPoolMax,
    statement_timeout: config.pgStatementTimeoutMs,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: false,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  }
  return new Pool(poolConfig)
}

export async function assertPostgresReady(pool: Pool): Promise<void> {
  await pool.query('SELECT 1')
}
