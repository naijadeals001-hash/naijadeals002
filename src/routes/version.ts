import { Hono } from 'hono'
import type { AppEnv } from '../types'

/**
 * GET /api/version — the single source of truth for "what is actually running
 * right now, and is its database in the state this code expects".
 *
 * This exists because of a real incident: on 2026-08-30/31 four migrations
 * (0005-0008) were committed to git and built into the deployed Worker, but were
 * never applied to the hosted production D1 database. The homepage 500'd because
 * `getActiveHeroCampaigns()` queried a table (`hero_campaigns`, migration 0008)
 * that the running code assumed existed but didn't. Nothing about the deployment
 * platform (worker_get, custom_domain_status) could answer "is my database
 * schema in sync with my code" — that check had to be built, so this route is it.
 *
 * `git_sha` / `expected_migrations` are BUILD-TIME constants (see vite.config.ts's
 * `define` block) — baked into the bundle at build time because Workers cannot
 * read the filesystem or shell out to git at runtime. `applied_migrations` is a
 * live D1 query — this IS available at runtime, unlike git/fs. Comparing the two
 * gives migration-parity truth without any hardcoded, driftable list anywhere.
 *
 * Called by scripts/verify_deployment.js as Gate 3 (Database) and to populate the
 * "Git SHA: <actual SHA>" line every deployment report must carry — never inferred
 * from commit messages or guessed from behavior.
 */
export const versionRoute = new Hono<AppEnv>()

versionRoute.get('/version', async (c) => {
  const db = c.env.DB
  let appliedMigrations: string[] = []
  let dbError: string | null = null

  try {
    const { results } = await db
      .prepare('SELECT name FROM d1_migrations ORDER BY id')
      .all<{ name: string }>()
    appliedMigrations = results.map((r) => r.name)
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  const expected = __EXPECTED_MIGRATIONS__
  const missing = expected.filter((m) => !appliedMigrations.includes(m))
  const unexpected = appliedMigrations.filter((m) => !expected.includes(m))
  const migrationsInSync = dbError === null && missing.length === 0

  const body = {
    git_sha: __GIT_SHA__,
    build_time: __BUILD_TIME__,
    db: {
      reachable: dbError === null,
      error: dbError,
      expected_migrations: expected,
      applied_migrations: appliedMigrations,
      missing_migrations: missing,
      unexpected_migrations: unexpected,
      in_sync: migrationsInSync
    },
    healthy: dbError === null && missing.length === 0
  }

  // Non-200 on drift/DB-unreachable is intentional: this makes /api/version itself
  // usable as a load-balancer/uptime-style health check, not just a human-readable
  // report — a monitoring system watching for non-200 here catches migration drift
  // the moment it happens, not the next time someone happens to hit a broken route.
  return c.json(body, body.healthy ? 200 : 503)
})
