import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Bake the exact git commit SHA that was checked out at BUILD time into the compiled
// worker bundle as a constant. This is the only reliable way to answer "what commit is
// actually running in production" for a Cloudflare Worker — there is no filesystem or
// child_process at runtime to shell out to `git rev-parse` on a live request, so it must
// be captured now, at build time, and burned into the bundle as a literal string.
// Exposed at runtime via GET /api/version (see src/index.tsx). Falls back to 'unknown'
// rather than failing the build if git isn't available in the build environment.
function getBuildGitSha(): string {
  try {
    return execSync('git rev-parse HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// Same rationale as getBuildGitSha(): the deployed Worker can't read the filesystem
// at runtime, so "which migration files exist in this commit" must be captured now,
// at build time, and burned into the bundle. This is what /api/version compares
// against `SELECT name FROM d1_migrations` (a live D1 query, which IS available at
// runtime) to answer "does the hosted database's applied-migrations list match what
// this exact commit expects?" without ever needing a hardcoded, driftable list in
// application source.
function getExpectedMigrations(): string[] {
  try {
    return readdirSync(resolve(__dirname, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
  } catch {
    return []
  }
}

export default defineConfig({
  define: {
    __GIT_SHA__: JSON.stringify(getBuildGitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __EXPECTED_MIGRATIONS__: JSON.stringify(getExpectedMigrations())
  },
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
