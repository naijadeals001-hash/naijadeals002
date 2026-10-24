import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'

const MIGRATION_LOCK_KEY = 7_314_2026

export function orderMigrationFiles(files: string[]): string[] {
  const candidates = files.filter((file) => /^\d+_.+\.sql$/.test(file))
  const prefixes = new Set<number>()
  for (const file of candidates) {
    const prefix = Number(file.match(/^(\d+)_/)?.[1])
    if (prefixes.has(prefix)) throw new Error(`Duplicate migration number: ${prefix}`)
    prefixes.add(prefix)
  }
  return candidates.sort((a, b) => {
    const aNumber = Number(a.match(/^(\d+)_/)?.[1])
    const bNumber = Number(b.match(/^(\d+)_/)?.[1])
    return aNumber - bNumber || a.localeCompare(b)
  })
}

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  const lockClient = await pool.connect()
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await lockClient.query(`CREATE TABLE IF NOT EXISTS naijadrive_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    const files = orderMigrationFiles(await readdir(migrationsDir))
    for (const file of files) {
      const applied = await lockClient.query('SELECT 1 FROM naijadrive_schema_migrations WHERE name = $1', [file])
      if (applied.rowCount) continue
      const sql = await readFile(join(migrationsDir, file), 'utf8')
      try {
        await lockClient.query('BEGIN')
        await lockClient.query(sql)
        await lockClient.query('INSERT INTO naijadrive_schema_migrations (name) VALUES ($1)', [file])
        await lockClient.query('COMMIT')
      } catch (error) {
        await lockClient.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    } finally {
      lockClient.release()
    }
  }
}
