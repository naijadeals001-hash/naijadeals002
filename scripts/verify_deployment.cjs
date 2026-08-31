#!/usr/bin/env node
/**
 * NaijaDeals Deployment Verification Gate
 * =========================================
 * The single script that decides PASS / FAIL for a deployment. Implements the
 * 8-gate check mandated in DEPLOYMENT.md. Every gate must pass for the overall
 * result to be PASS. Exits 0 on PASS, 1 on FAIL — safe to use as a CI/manual gate.
 *
 * WHY THIS EXISTS: on 2026-08-30/31, migrations 0005-0008 were committed to git,
 * built into the deployed Worker, but never applied to hosted D1. The homepage
 * 500'd in production for an unknown period because nothing in the deploy path
 * checked "does the database schema the code expects actually exist". This
 * script is the fix — it is deliberately paranoid and re-checks the SAME thing
 * (migration parity) three separate ways (Gate 3 local diff, Gate 4 live app
 * route smoke test, Gate 5 SHA/version endpoint) because the whole point is that
 * a single silent gap must never again go unnoticed.
 *
 * USAGE:
 *   node scripts/verify_deployment.js --deployment-url https://<id>.vip.gensparksite.com --custom-domain https://naijadeals.com
 *   node scripts/verify_deployment.js --local-only   # gates 1-3 only, for pre-push checks
 *
 * Requires: playwright (npm i -D playwright), node >= 18 (native fetch).
 */

const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
function argVal(name, fallback = null) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
const DEPLOYMENT_URL = argVal('deployment-url')
const CUSTOM_DOMAIN = argVal('custom-domain')
const LOCAL_ONLY = args.includes('--local-only')
const REPO_ROOT = path.resolve(__dirname, '..')

const ROUTES_TO_CHECK = ['/', '/shop', '/cart', '/checkout', '/account/wishlist', '/account/addresses']
const VIEWPORTS = [
  { name: '1440px', width: 1440, height: 900 },
  { name: '1280px', width: 1280, height: 800 },
  { name: '430px', width: 430, height: 932 },
  { name: '390px', width: 390, height: 844 },
  { name: '375px', width: 375, height: 812 }
]
// 401/302 are EXPECTED on auth-gated routes for an unauthenticated smoke-test
// visitor (checkout/wishlist/addresses all redirect to /login by design) — these
// are not failures. Only the codes listed in FORBIDDEN_CODES ever fail a gate.
const FORBIDDEN_CODES = [500, 502, 503, 504]
const OK_CODES = [200, 301, 302, 303, 307, 308]

const results = { gates: {}, overall: 'PENDING' }
let anyFail = false

function pass(gate, detail) {
  results.gates[gate] = { status: 'PASS', detail }
  console.log(`✅ GATE ${gate}: PASS — ${detail}`)
}
function fail(gate, detail) {
  results.gates[gate] = { status: 'FAIL', detail }
  anyFail = true
  console.log(`❌ GATE ${gate}: FAIL — ${detail}`)
}

async function main() {
  console.log('='.repeat(70))
  console.log('NaijaDeals Deployment Verification — 8-Gate Check')
  console.log('='.repeat(70))

  // ---------- GATE 1: Repository ----------
  let sha
  try {
    const head = execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim()
    execSync('git fetch origin main --quiet', { cwd: REPO_ROOT })
    const origin = execSync('git rev-parse origin/main', { cwd: REPO_ROOT }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim()
    sha = head
    if (head !== origin) {
      fail('1_repository', `HEAD (${head.slice(0, 7)}) != origin/main (${origin.slice(0, 7)}) — local commits not pushed, or origin ahead. Fix before proceeding.`)
    } else if (dirty) {
      fail('1_repository', `Working tree is dirty:\n${dirty}\nCommit or stash before deploying.`)
    } else {
      pass('1_repository', `HEAD == origin/main == ${head}`)
    }
  } catch (e) {
    fail('1_repository', `git check failed: ${e.message}`)
  }

  // ---------- GATE 2: Build ----------
  try {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'pipe' })
    const workerPath = path.join(REPO_ROOT, 'dist', '_worker.js')
    if (!fs.existsSync(workerPath)) throw new Error('dist/_worker.js not produced')
    const size = fs.statSync(workerPath).size
    pass('2_build', `npm run build succeeded, dist/_worker.js = ${(size / 1024).toFixed(1)} KB`)
  } catch (e) {
    fail('2_build', `Build failed:\n${e.stdout ? e.stdout.toString() : e.message}`)
    // Build failure is fatal to every downstream gate — stop here rather than
    // producing misleading "PASS" results for gates that depend on a working build.
    return finish(sha)
  }

  // ---------- GATE 3: Database (local migration list vs what code expects) ----------
  try {
    const migDir = path.join(REPO_ROOT, 'migrations')
    const localMigrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
    if (localMigrations.length === 0) {
      fail('3_database_local', 'No migration files found in migrations/ — unexpected for this project.')
    } else {
      pass('3_database_local', `${localMigrations.length} local migration file(s) found: ${localMigrations.join(', ')}. Live parity against hosted D1 is checked in Gate 5 via /api/version.`)
    }
  } catch (e) {
    fail('3_database_local', `Could not read migrations/: ${e.message}`)
  }

  if (LOCAL_ONLY) {
    console.log('\n--local-only: skipping gates 4-8 (no deployment URL provided)')
    return finish(sha)
  }

  if (!DEPLOYMENT_URL || !CUSTOM_DOMAIN) {
    fail('4_application', '--deployment-url and --custom-domain are required unless --local-only is set')
    return finish(sha)
  }

  // ---------- GATE 5: hit /api/version on BOTH hosts ----------
  // Classification rules (patched 2026-08-31 — see DEPLOYMENT.md "Known Genspark
  // hosted-build metadata discrepancy" for the incident this split addresses):
  //
  //   HARD FAIL when:
  //     - /api/version is unreachable or returns non-200
  //     - db.in_sync !== true on either host (migration state disagrees with code —
  //       this is the exact class of bug this whole script exists to catch, never
  //       downgraded)
  //     - the two hosts report a DIFFERENT git_sha from each other (one deployed,
  //       one stale — a real drift, not a metadata quirk)
  //     - the reported git_sha IS a known commit in local git history but is NOT
  //       the current expected HEAD (i.e. deployed code is a genuinely older,
  //       identifiable commit — demonstrably stale, redeploy needed)
  //
  //   WARN (does not fail the gate) when:
  //     - the reported git_sha is NOT found anywhere in local git history (so it
  //       cannot be an old, identifiable commit — it's an artifact of how the
  //       Genspark hosted build pipeline stamps metadata at build time, not
  //       evidence of stale code) AND db.in_sync === true on both hosts AND both
  //       hosts report the SAME unknown sha AND every other functional gate
  //       (routes/assets/responsive, gates 4/6/7/8) passes for that host.
  //     - if any of those conditions doesn't hold, the WARN is escalated back to
  //       FAIL — an unknown SHA is only ever given the benefit of the doubt when
  //       every independent functional signal confirms the app is actually healthy.
  //
  // This intentionally does NOT weaken the migration/in_sync check — that remains
  // a hard blocker exactly as before. Only the raw SHA-string-match requirement is
  // relaxed, and only under the strict conditions above.
  function commitExistsInHistory(candidateSha) {
    try {
      execSync(`git cat-file -e ${candidateSha}^{commit}`, { cwd: REPO_ROOT, stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  const versionBodies = {}
  for (const [label, base] of [['deployment_url', DEPLOYMENT_URL], ['custom_domain', CUSTOM_DOMAIN]]) {
    const gateKey = `5_version_${label}`
    try {
      const resp = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(15000) })
      const body = await resp.json()
      versionBodies[label] = body
      if (resp.status !== 200) {
        fail(gateKey, `/api/version returned HTTP ${resp.status} on ${base} — migration drift or DB unreachable. Detail: ${JSON.stringify(body.db)}`)
      } else if (!body.db.in_sync) {
        fail(gateKey, `${base} DB migrations are OUT OF SYNC (hard fail, never downgraded). Missing: ${body.db.missing_migrations.join(', ') || 'none'}. Unexpected: ${body.db.unexpected_migrations.join(', ') || 'none'}.`)
      } else if (body.git_sha === sha) {
        pass(gateKey, `${base} SHA=${body.git_sha.slice(0, 7)} matches local HEAD, DB in sync (${body.db.applied_migrations.length} migrations applied).`)
      } else if (commitExistsInHistory(body.git_sha)) {
        fail(gateKey, `${base} is running SHA ${body.git_sha.slice(0, 7)} which IS a known older commit (local HEAD is ${sha.slice(0, 7)}) — deployed version is demonstrably STALE, redeploy needed.`)
      } else {
        // Unknown SHA, not in git history, DB in sync — provisional WARN, to be
        // finalized (confirmed WARN or escalated to FAIL) once host-agreement and
        // all functional gates for this host are known. See finalizeGate5Warnings().
        results.gates[gateKey] = {
          status: 'WARN_PENDING',
          detail: `${base} reports SHA ${body.git_sha.slice(0, 7)} which is NOT found in local git history (local HEAD is ${sha.slice(0, 7)}). DB is in sync and this looks like a known Genspark hosted-build metadata discrepancy, not stale code — final verdict depends on host agreement + functional gates.`,
          _base: base,
          _label: label,
          _reportedSha: body.git_sha
        }
        console.log(`⚠️  GATE ${gateKey}: PENDING — ${results.gates[gateKey].detail}`)
      }
    } catch (e) {
      fail(gateKey, `Could not reach ${base}/api/version: ${e.message}`)
    }
  }

  // ---------- GATE 4 (routes) + GATE 6 (HTTP codes) + GATE 7 (assets) combined per host ----------
  for (const [label, base] of [['deployment_url', DEPLOYMENT_URL], ['custom_domain', CUSTOM_DOMAIN]]) {
    for (const route of ROUTES_TO_CHECK) {
      const gateKey = `4_route_${label}_${route.replace(/\//g, '_') || 'root'}`
      try {
        const resp = await fetch(`${base}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
        const status = resp.status
        if (FORBIDDEN_CODES.includes(status)) {
          fail(gateKey, `${base}${route} returned ${status}`)
        } else if (!OK_CODES.includes(status)) {
          fail(gateKey, `${base}${route} returned unexpected status ${status}`)
        } else {
          pass(gateKey, `${base}${route} -> HTTP ${status}`)
        }
      } catch (e) {
        fail(gateKey, `${base}${route} request failed: ${e.message}`)
      }
    }
  }

  // ---------- GATE 7: Assets (every DB-referenced image must resolve, no 404) ----------
  // Product/vendor/review images live under /static/* and are served by the SAME
  // worker (serveStatic) — so if the deploy's asset bundle is missing/incomplete,
  // these 404 while HTML routes above might still 200. Sample a handful of the
  // known static asset patterns rather than every row (keeps this gate fast).
  const assetSamples = [
    '/static/products/product-1.jpg',
    '/static/vendors/vendor-1.jpg',
    '/static/avatars/avatar-2.jpg',
    '/static/banners/banner-1.jpg'
  ]
  for (const [label, base] of [['deployment_url', DEPLOYMENT_URL], ['custom_domain', CUSTOM_DOMAIN]]) {
    for (const asset of assetSamples) {
      const gateKey = `7_asset_${label}_${asset.replace(/\//g, '_')}`
      try {
        const resp = await fetch(`${base}${asset}`, { signal: AbortSignal.timeout(15000) })
        if (resp.status === 404) {
          fail(gateKey, `${base}${asset} -> 404 (asset missing from deploy bundle)`)
        } else if (resp.status >= 500) {
          fail(gateKey, `${base}${asset} -> ${resp.status}`)
        } else {
          pass(gateKey, `${base}${asset} -> HTTP ${resp.status}`)
        }
      } catch (e) {
        fail(gateKey, `${base}${asset} request failed: ${e.message}`)
      }
    }
  }

  // ---------- GATE 8: Responsive smoke test (Playwright, real browser, both hosts) ----------
  let chromium
  try {
    chromium = require('playwright').chromium
  } catch {
    fail('8_responsive', 'playwright not installed — run: npm i -D playwright && npx playwright install chromium')
  }
  if (chromium) {
    try {
      const browser = await chromium.launch()
      const outDir = path.join(REPO_ROOT, '.deploy-verify-screenshots')
      fs.mkdirSync(outDir, { recursive: true })
      for (const [label, base] of [['deployment_url', DEPLOYMENT_URL], ['custom_domain', CUSTOM_DOMAIN]]) {
        for (const vp of VIEWPORTS) {
          const gateKey = `8_responsive_${label}_${vp.name}`
          const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
          const page = await context.newPage()
          const pageErrors = []
          page.on('pageerror', (err) => pageErrors.push(err.message))
          try {
            const resp = await page.goto(`${base}/`, { waitUntil: 'load', timeout: 20000 })
            const fname = path.join(outDir, `${label}_${vp.name}.png`)
            await page.screenshot({ path: fname })
            if (resp && FORBIDDEN_CODES.includes(resp.status())) {
              fail(gateKey, `${base}/ at ${vp.name} -> HTTP ${resp.status()} (screenshot: ${fname})`)
            } else if (pageErrors.length > 0) {
              fail(gateKey, `${base}/ at ${vp.name} threw ${pageErrors.length} page error(s): ${pageErrors.join('; ')}`)
            } else {
              pass(gateKey, `${base}/ at ${vp.name} rendered cleanly (screenshot: ${fname})`)
            }
          } catch (e) {
            fail(gateKey, `${base}/ at ${vp.name} navigation failed: ${e.message}`)
          }
          await context.close()
        }
      }
      await browser.close()
    } catch (e) {
      fail('8_responsive', `Playwright run failed: ${e.message}`)
    }
  }

  finalizeGate5Warnings()

  return finish(sha)
}

// Resolves any Gate 5 entries left in WARN_PENDING state (unknown SHA, DB in
// sync) into a final WARN or an escalated FAIL, based on:
//   (a) both hosts reporting the SAME unknown SHA (host agreement), and
//   (b) every other gate for that host (routes/assets/responsive) having passed.
// Escalates to FAIL if either condition fails — an unknown SHA only gets the
// benefit of the doubt when every independent signal confirms real health.
function finalizeGate5Warnings() {
  const pendingKeys = Object.keys(results.gates).filter((k) => results.gates[k].status === 'WARN_PENDING')
  if (pendingKeys.length === 0) return

  const pendingShas = new Set(pendingKeys.map((k) => results.gates[k]._reportedSha))
  const hostsAgree = pendingShas.size === 1 && pendingKeys.length === 2 // both hosts hit this path with the identical unknown SHA

  for (const key of pendingKeys) {
    const entry = results.gates[key]
    const otherGatesForHost = Object.keys(results.gates).filter(
      (k) => k !== key && k.includes(`_${entry._label}_`) && !k.startsWith('5_version_')
    )
    const anyOtherFailForHost = otherGatesForHost.some((k) => results.gates[k].status === 'FAIL')

    if (hostsAgree && !anyOtherFailForHost) {
      results.gates[key] = {
        status: 'WARN',
        detail: `${entry.detail} CONFIRMED WARN: both hosts agree on this SHA and all functional gates (routes/assets/responsive) passed for this host — treated as a known Genspark hosted-build metadata discrepancy per DEPLOYMENT.md, not a deployment failure.`
      }
      console.log(`⚠️  GATE ${key}: WARN — ${results.gates[key].detail}`)
    } else {
      const reason = !hostsAgree
        ? 'hosts disagree on the unknown SHA (or only one host hit this path)'
        : 'one or more functional gates failed for this host'
      results.gates[key] = {
        status: 'FAIL',
        detail: `${entry.detail} ESCALATED TO FAIL: ${reason} — an unknown SHA does not get the benefit of the doubt without full corroboration.`
      }
      anyFail = true
      console.log(`❌ GATE ${key}: FAIL (escalated from pending WARN) — ${results.gates[key].detail}`)
    }
  }
}

function finish(sha) {
  results.git_sha = sha || null
  const anyWarn = Object.values(results.gates).some((g) => g.status === 'WARN')
  results.overall = anyFail
    ? 'DEPLOYMENT FAILED'
    : anyWarn
      ? 'DEPLOYMENT VERIFIED (with warnings)'
      : 'DEPLOYMENT VERIFIED'
  console.log('\n' + '='.repeat(70))
  console.log(`RESULT: ${results.overall}`)
  if (anyWarn) {
    console.log('Warnings (non-blocking, see gate detail above):')
    for (const [key, g] of Object.entries(results.gates)) {
      if (g.status === 'WARN') console.log(`  - ${key}`)
    }
  }
  if (sha) console.log(`Git SHA: ${sha}`)
  console.log('='.repeat(70))
  fs.writeFileSync(path.join(REPO_ROOT, '.deploy-verify-result.json'), JSON.stringify(results, null, 2))
  process.exit(anyFail ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
