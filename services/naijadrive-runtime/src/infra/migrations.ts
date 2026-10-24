import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS naijadrive_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM naijadrive_schema_migrations WHERE name = $1', [file])
    if (applied.rowCount) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO naijadrive_schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      client.release()
    }
  }
}
