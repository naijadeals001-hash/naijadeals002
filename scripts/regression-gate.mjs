import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify((await import('node:child_process')).execFile)
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
const requestedSuite = process.env.REGRESSION_SUITE ?? null
const selectedHttpSuites = requestedSuite ? httpSuites.filter(([label]) => label === requestedSuite) : httpSuites
const selectedDirectSuites = requestedSuite ? directSuites.filter(([label]) => label === requestedSuite) : directSuites

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function killProcessTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return
  try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch {} }
}

function classifyFailure(output, timedOut = false) {
  if (timedOut || /fetch failed|ECONNREFUSED|ECONNRESET|Worker.*crash|workerd|Miniflare|SQLITE_BUSY|SQLITE_BUSY_SNAPSHOT|database is locked|D1_ERROR|internal error/i.test(output)) return 'INFRASTRUCTURE_FAILURE'
  return 'ASSERTION_FAILURE'
}

async function runCommand(command, args, env, label) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return await new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const output = `${stdout}\n${stderr}\nTimed out after ${suiteTimeoutMs}ms`
      killProcessTree(child, 'SIGTERM')
      setTimeout(() => killProcessTree(child, 'SIGKILL'), 2_000)
      resolve({ label, ok: false, infrastructure: true, kind: 'INFRASTRUCTURE_FAILURE', timedOut: true, output })
    }, suiteTimeoutMs)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = `${stdout}\n${stderr}\n${error.stack ?? error}`
      resolve({ label, ok: false, infrastructure: true, kind: 'INFRASTRUCTURE_FAILURE', output })
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = `${stdout}\n${stderr}`
      if (code === 0) resolve({ label, ok: true, infrastructure: false, kind: 'PASS', output })
      else {
        const kind = classifyFailure(output)
        resolve({ label, ok: false, infrastructure: kind === 'INFRASTRUCTURE_FAILURE', kind, exitCode: code, signal, output })
      }
    })
  })
}

async function backupSqlite(source, target) {
  await execFileAsync('sqlite3', [source, `.backup '${target}'`], { cwd: root, maxBuffer: 2 * 1024 * 1024 })
}

async function prepareIsolatedDatabase(persistTo) {
  const source = path.join(root, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
  const target = path.join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  await mkdir(target, { recursive: true })
  await backupSqlite(
    path.join(source, '9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite'),
    path.join(target, '9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite')
  )
  await backupSqlite(path.join(source, 'metadata.sqlite'), path.join(target, 'metadata.sqlite'))
}

async function startServer(persistTo, label) {
  const logPath = path.join(root, 'qa-screenshots', `${runId}-${label}-worker.log`)
  const log = await import('node:fs').then(({ createWriteStream }) => createWriteStream(logPath, { flags: 'w' }))
  const child = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--d1=naijadeals-production', '--local', `--persist-to=${persistTo}`, '--ip=127.0.0.1', `--port=${port}`, '--show-interactive-dev-session=false'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseURL}/`)
      if (response.status === 200) return { child, logPath, log }
    } catch {}
    await sleep(500)
  }
  killProcessTree(child, 'SIGTERM')
  await sleep(500)
  killProcessTree(child, 'SIGKILL')
  log.end()
  throw new Error(`Dedicated regression Worker did not start for ${label}. Log: ${logPath}`)
}

async function stopServer(server) {
  if (!server) return
  killProcessTree(server.child, 'SIGTERM')
  await Promise.race([new Promise((resolve) => server.child.once('close', resolve)), sleep(5_000)])
  killProcessTree(server.child, 'SIGKILL')
  server.log.end()
}

const scratch = await mkdtemp(path.join(tmpdir(), `${runId}-`))
const results = []
let server

try {
  for (const [label, file, env] of selectedHttpSuites) {
    const persistTo = path.join(scratch, label)
    await prepareIsolatedDatabase(persistTo)
    server = await startServer(persistTo, label)
    const result = await runCommand(process.execPath, ['scripts/test-node.mjs', file], {
      MKT_TEST_PERSIST_TO: persistTo,
      PAYMENT_TEST_PERSIST_TO: persistTo,
      NOTIF_TEST_PERSIST_TO: persistTo,
      ...env,
    }, label)
    result.workerLog = server.logPath
    results.push(result)
    await stopServer(server)
    server = undefined
    process.stdout.write(`${label}: ${result.kind}\n`)
    if (!result.ok) break
  }

  if (results.every((result) => result.ok)) {
    for (const [label, file, variable] of selectedDirectSuites) {
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
