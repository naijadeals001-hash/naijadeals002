import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const runId = `regression-${Date.now()}`
const port = 3187
const baseURL = `http://localhost:${port}`
const suiteTimeoutMs = 180_000
const workerStartupMs = 60_000

const httpSuites = [
  ['rollout-guards', 'tests/transaction-rollout-guard.test.mjs', {}],
  ['shop-checkout', 'tests/marketplace-engine/06.checkout-idempotency.test.mjs', { MKT_TEST_BASE_URL: baseURL }],
  ['drive-private', 'tests/naijadrive-private-ride.test.mjs', { MKT_TEST_BASE_URL: baseURL }],
  ['drive-carpool', 'tests/naijadrive-carpool-api.test.mjs', { MKT_TEST_BASE_URL: baseURL }],
  ['naijapay-rollout', 'tests/naijapay-rollout-guard.test.mjs', { MKT_TEST_BASE_URL: baseURL }],
  ['gigs-collaboration', 'tests/naijagigs-collaboration.test.mjs', { NAIJADEALS_PREVIEW_URL: baseURL }],
  ['stay-host', 'tests/naijastay-host-operations.test.mjs', { NAIJADEALS_PREVIEW_URL: baseURL }],
]

const directSuites = [
  ['eats-operator', 'tests/naijaeats-operator.test.mjs', 'PAYMENT_TEST_PERSIST_TO'],
  ['eats-courier', 'tests/naijaeats-courier-dispatch.test.mjs', 'PAYMENT_TEST_PERSIST_TO'],
  ['payment-concurrency', 'tests/payment-engine/01.wallet-concurrency.test.mjs', 'PAYMENT_TEST_PERSIST_TO'],
  ['notification-idempotency', 'tests/notification-engine/02.idempotency-concurrency.test.mjs', 'NOTIF_TEST_PERSIST_TO'],
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function outputOf(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

function classifyFailure(output, timedOut = false) {
  if (timedOut || /fetch failed|ECONNREFUSED|ECONNRESET|Worker.*crash|workerd|Miniflare|SQLITE_BUSY|SQLITE_BUSY_SNAPSHOT|database is locked|D1_ERROR|internal error/i.test(output)) {
    return 'INFRASTRUCTURE_FAILURE'
  }
  return 'ASSERTION_FAILURE'
}

function killProcessTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return
  // Detached children are placed in their own process group. Killing the group
  // prevents Wrangler/workerd descendants surviving a timed-out suite.
  try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch {} }
}

async function runCommand(command, args, env, label) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const result = await new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killProcessTree(child, 'SIGTERM')
      setTimeout(() => killProcessTree(child, 'SIGKILL'), 2_000)
      resolve({ label, ok: false, infrastructure: true, kind: 'INFRASTRUCTURE_FAILURE', timedOut: true, output: `${stdout}\n${stderr}\nTimed out after ${suiteTimeoutMs}ms` })
    }, suiteTimeoutMs)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ label, ok: false, infrastructure: true, kind: 'INFRASTRUCTURE_FAILURE', output: `${stdout}\n${stderr}\n${error.stack ?? error}` })
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = `${stdout}\n${stderr}`
      if (code === 0) resolve({ label, ok: true, infrastructure: false, kind: 'PASS', output })
      else resolve({ label, ok: false, infrastructure: classifyFailure(output) === 'INFRASTRUCTURE_FAILURE', kind: classifyFailure(output), exitCode: code, signal, output })
    })
  })
  return result
}

async function prepareIsolatedDatabase(persistTo) {
  const sourceD1 = path.join(root, '.wrangler', 'state', 'v3', 'd1')
  const targetD1 = path.join(persistTo, 'v3', 'd1')
  // Migration 0068 is a historical data migration that assumes the seeded
  // catalog. Replaying the entire history from empty fails at its FK boundary.
  // Copy only the existing D1 state into a test-owned directory instead. The
  // source is never opened for writing by this runner.
  await cp(sourceD1, targetD1, { recursive: true, force: false, preserveTimestamps: true })
}

async function startServer(persistTo, label) {
  const logPath = path.join(root, 'qa-screenshots', `${runId}-${label}-worker.log`)
  const logHandle = await import('node:fs').then(({ createWriteStream }) => createWriteStream(logPath, { flags: 'w' }))
  const child = spawn('npx', [
    'wrangler', 'pages', 'dev', 'dist', '--d1=naijadeals-production', '--local',
    `--persist-to=${persistTo}`, '--ip=127.0.0.1', `--port=${port}`,
    '--show-interactive-dev-session=false',
  ], { cwd: root, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(logHandle)
  child.stderr.pipe(logHandle)
  const started = await new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false) } }, workerStartupMs)
    child.once('exit', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(false) } })
    const poll = async () => {
      for (;;) {
        if (settled) return
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`)
          if (response.status === 200) { settled = true; clearTimeout(timer); resolve(true); return }
        } catch {}
        await sleep(500)
      }
    }
    poll()
  })
  if (!started) {
    killProcessTree(child, 'SIGTERM')
    await sleep(500)
    killProcessTree(child, 'SIGKILL')
    logHandle.end()
    throw new Error(`Dedicated regression Worker did not start for ${label}. Log: ${logPath}`)
  }
  return { child, logPath, logHandle }
}

async function stopServer(server) {
  if (!server) return
  killProcessTree(server.child, 'SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.child.once('close', resolve)),
    sleep(5_000),
  ])
  killProcessTree(server.child, 'SIGKILL')
  server.logHandle.end()
}

const scratch = await mkdtemp(path.join(tmpdir(), `${runId}-`))
const results = []
let server

async function runSuite(label, file, env, persistTo) {
  await prepareIsolatedDatabase(persistTo)
  server = await startServer(persistTo, label)
  const result = await runCommand(process.execPath, ['scripts/test-node.mjs', file], {
    MKT_TEST_PERSIST_TO: persistTo,
    PAYMENT_TEST_PERSIST_TO: persistTo,
    NOTIF_TEST_PERSIST_TO: persistTo,
    ...env,
  }, label)
  result.workerLog = server.logPath
  await stopServer(server)
  server = undefined
  return result
}

try {
  for (const [label, file, env] of httpSuites) {
    const persistTo = path.join(scratch, label)
    const result = await runSuite(label, file, env, persistTo)
    results.push(result)
    process.stdout.write(`${label}: ${result.kind}\n`)
    if (!result.ok) break
  }

  if (results.every((result) => result.ok)) {
    for (const [label, file, variable] of directSuites) {
      const persistTo = path.join(scratch, label)
      await prepareIsolatedDatabase(persistTo)
      const result = await runCommand(process.execPath, ['scripts/test-node.mjs', file], { [variable]: persistTo }, label)
      result.persistTo = persistTo
      results.push(result)
      process.stdout.write(`${label}: ${result.kind}\n`)
      if (!result.ok) break
    }
  }
} catch (error) {
  results.push({ label: 'bootstrap', ok: false, infrastructure: true, kind: 'INFRASTRUCTURE_FAILURE', output: error.stack ?? String(error) })
  process.stderr.write(`${error.stack ?? error}\n`)
} finally {
  await stopServer(server)
  const evidencePath = path.join(root, 'qa-screenshots', `${runId}-results.json`)
  await writeFile(evidencePath, JSON.stringify(results, null, 2))
  process.stdout.write(`Regression evidence: ${evidencePath}\n`)
  await rm(scratch, { recursive: true, force: true })
}

if (results.some((result) => !result.ok)) process.exit(1)
