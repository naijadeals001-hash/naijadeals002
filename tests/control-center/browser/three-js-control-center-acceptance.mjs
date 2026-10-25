import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import {
  BASE_URL,
  RUN_NONCE,
  registerUser,
  grantControlCenterRole,
  cleanupRunNonce,
  execD1,
} from '../helpers/client.mjs'

const evidenceDir = new URL('../../../qa-screenshots/three-js-control-center/', import.meta.url).pathname
const profiles = [
  ['desktop-1440x900', 1440, 900],
  ['small-desktop-1280x800', 1280, 800],
  ['tablet-768x1024', 768, 1024],
  ['mobile-390x844', 390, 844],
]

async function loginControlCenter(page, email, password) {
  await page.goto(`${BASE_URL}/control-center/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="identifier"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('#cc-login-form button[type="submit"]')
  await page.waitForURL(`${BASE_URL}/control-center`, { timeout: 10000 })
}

async function inspectPage(page, name, width, height, reducedMotion = false) {
  await page.setViewportSize({ width, height })
  const consoleErrors = []
  const failedRequests = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`))
  await page.goto(`${BASE_URL}/control-center`, { waitUntil: 'networkidle' })
  const section = page.locator('#cc-operations-environment')
  await section.scrollIntoViewIfNeeded()
  await page.waitForTimeout(1200)

  const result = await page.evaluate(() => {
    const root = document.querySelector('[data-cc-3d-root]')
    const canvas = root?.querySelector('[data-cc-3d-canvas]')
    const fallback = root?.querySelector('[data-cc-3d-fallback]')
    const selected = root?.querySelector('[data-cc-3d-selected-name]')
    const link = root?.querySelector('[data-cc-3d-selected-link]')
    return {
      root: Boolean(root),
      canvas: Boolean(canvas),
      canvasHidden: canvas?.hidden ?? null,
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      canvasClientWidth: canvas?.clientWidth ?? 0,
      canvasClientHeight: canvas?.clientHeight ?? 0,
      fallbackHidden: fallback?.hidden ?? null,
      selectedName: selected?.textContent ?? '',
      selectedHref: link?.getAttribute('href') ?? '',
      fallbackItems: root?.querySelectorAll('[data-cc-3d-fallback-item]').length ?? 0,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      moduleScripts: [...document.querySelectorAll('script[type="module"]')].map((script) => script.getAttribute('src')).filter(Boolean),
      topologyData: (() => { try { return JSON.parse(root?.querySelector('[data-cc-3d-data]')?.textContent || '[]').length } catch { return -1 } })(),
    }
  })

  assert.equal(result.root, true, `${name}: operations environment missing`)
  assert.equal(result.topologyData > 0, true, `${name}: registry data missing`)
  assert.equal(result.scrollWidth, result.viewportWidth, `${name}: unexpected horizontal overflow`)
  assert.equal(result.moduleScripts.includes('/static/control-center-3d.js'), true, `${name}: local module script missing`)
  assert.notEqual(result.selectedName, 'Loading topology…', `${name}: inspector did not initialize`)
  assert.ok(result.selectedHref.startsWith('/'), `${name}: inspector link is not a local navigation link`)

  if (result.canvasHidden) {
    assert.equal(result.fallbackHidden, false, `${name}: hidden canvas must expose HTML fallback`)
    assert.ok(result.fallbackItems > 0, `${name}: HTML fallback has no registry items`)
  } else {
    assert.ok(result.canvasClientWidth > 0 && result.canvasClientHeight > 0, `${name}: canvas has no usable dimensions`)
    assert.ok(result.canvasWidth > 0 && result.canvasHeight > 0, `${name}: renderer canvas has no backing dimensions`)
  }

  await page.screenshot({ path: `${evidenceDir}${name}.png`, fullPage: true })
  return { name, viewport: { width, height }, reducedMotion, result, consoleErrors, failedRequests }
}

async function run() {
  const results = []
  await execD1("DELETE FROM login_attempts WHERE ip_address = '127.0.0.1'").catch(() => {})
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] })
  let fixture
  try {
    fixture = await registerUser('threejs')
    await grantControlCenterRole(fixture.userId, 'platform_admin')

    for (const [name, width, height] of profiles) {
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      await loginControlCenter(page, fixture.email, fixture.password)
      results.push(await inspectPage(page, name, width, height))
      await context.close()
    }

    const reducedContext = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } })
    const reducedPage = await reducedContext.newPage()
    await loginControlCenter(reducedPage, fixture.email, fixture.password)
    const reduced = await inspectPage(reducedPage, 'reduced-motion-1440x900', 1440, 900, true)
    const reducedNote = await reducedPage.locator('[data-cc-3d-reduced-note]').isVisible().catch(() => false)
    reduced.reducedMotionNoteVisible = reducedNote
    if (!reduced.result.canvasHidden) assert.equal(reducedNote, true, 'reduced-motion: expected reduced motion note when WebGL is active')
    results.push(reduced)
    await reducedContext.close()

    const fallbackContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await fallbackContext.route('**/static/vendor/three.module.min.js', (route) => route.abort())
    const fallbackPage = await fallbackContext.newPage()
    await loginControlCenter(fallbackPage, fixture.email, fixture.password)
    await fallbackPage.locator('#cc-operations-environment').scrollIntoViewIfNeeded()
    await fallbackPage.waitForTimeout(1200)
    const fallbackState = await fallbackPage.evaluate(() => {
      const root = document.querySelector('[data-cc-3d-root]')
      return {
        fallbackHidden: root?.querySelector('[data-cc-3d-fallback]')?.hidden ?? true,
        message: root?.querySelector('[data-cc-3d-message]')?.textContent ?? '',
        itemCount: root?.querySelectorAll('[data-cc-3d-fallback-item]').length ?? 0,
      }
    })
    assert.equal(fallbackState.fallbackHidden, false, 'forced module failure: HTML fallback did not activate')
    assert.ok(fallbackState.itemCount > 0, 'forced module failure: registry fallback is empty')
    assert.match(fallbackState.message, /could not be loaded|fallback/i)
    await fallbackPage.screenshot({ path: `${evidenceDir}forced-module-fallback.png`, fullPage: true })
    results.push({ name: 'forced-module-fallback', fallbackState, consoleErrors: [], failedRequests: [] })
    await fallbackContext.close()

    const lifecycleContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await lifecycleContext.addInitScript(() => {
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window)
      window.__cc3dFrameSchedules = 0
      window.requestAnimationFrame = (callback) => {
        window.__cc3dFrameSchedules += 1
        return nativeRequestAnimationFrame(callback)
      }
    })
    const lifecyclePage = await lifecycleContext.newPage()
    await loginControlCenter(lifecyclePage, fixture.email, fixture.password)
    await lifecyclePage.locator('#cc-operations-environment').scrollIntoViewIfNeeded()
    await lifecyclePage.waitForTimeout(1200)
    const visibility = await lifecyclePage.evaluate(async () => {
      const root = document.querySelector('[data-cc-3d-root]')
      const canvas = root?.querySelector('[data-cc-3d-canvas]')
      if (canvas?.hidden) return { skipped: true }
      const before = window.__cc3dFrameSchedules
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((resolve) => setTimeout(resolve, 150))
      const hidden = window.__cc3dFrameSchedules
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((resolve) => setTimeout(resolve, 150))
      return { skipped: false, before, hidden, resumed: window.__cc3dFrameSchedules }
    })
    if (!visibility.skipped) {
      assert.equal(visibility.hidden, visibility.before, 'visibility: animation scheduling continued while hidden')
      assert.ok(visibility.resumed > visibility.hidden, 'visibility: animation loop did not resume')
    }
    const lifecycle = await lifecyclePage.evaluate(() => {
      const root = document.querySelector('[data-cc-3d-root]')
      const canvas = root?.querySelector('[data-cc-3d-canvas]')
      const fallback = root?.querySelector('[data-cc-3d-fallback]')
      const before = { canvasHidden: canvas?.hidden ?? true, fallbackHidden: fallback?.hidden ?? true }
      const event = new Event('webglcontextlost', { bubbles: false, cancelable: true })
      canvas?.dispatchEvent(event)
      const afterLoss = { canvasHidden: canvas?.hidden ?? true, fallbackHidden: fallback?.hidden ?? true, message: root?.querySelector('[data-cc-3d-message]')?.textContent ?? '' }
      root?.dispatchEvent(new Event('cc-3d-dispose'))
      return { before, afterLoss }
    })
    if (!lifecycle.before.canvasHidden) {
      assert.equal(lifecycle.afterLoss.fallbackHidden, false, 'context loss: fallback did not activate')
      assert.match(lifecycle.afterLoss.message, /context was lost/i)
    }
    results.push({ name: 'context-loss-and-dispose', lifecycle, visibility })
    await lifecycleContext.close()
  } finally {
    await browser.close()
    if (fixture) await cleanupRunNonce(RUN_NONCE).catch((error) => console.error('fixture cleanup failed:', error.message))
  }

  await writeFile(`${evidenceDir}three-js-browser-results.json`, JSON.stringify({ baseUrl: BASE_URL, runNonce: RUN_NONCE, results }, null, 2))
  const unexpectedConsole = results.flatMap((item) => item.consoleErrors || [])
  const failedRequests = results.flatMap((item) => item.failedRequests || []).filter((value) => !value.includes('three.module.min.js'))
  assert.equal(unexpectedConsole.length, 0, `unexpected browser console errors: ${unexpectedConsole.join('\n')}`)
  assert.equal(failedRequests.length, 0, `unexpected failed requests: ${failedRequests.join('\n')}`)
  console.log(JSON.stringify({ profiles: profiles.map(([name]) => name), reducedMotion: true, forcedFallback: true, contextLoss: true, unexpectedConsoleErrors: unexpectedConsole.length, failedRequests: failedRequests.length }, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
