import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.env.PREVIEW_URL || 'http://localhost:3000'
const routes = ['/move','/market','/services','/travel','/play','/property','/health','/jobs','/business','/auto','/homes','/events','/learn','/farm','/home','/beauty','/send','/stream']

test('all consolidated vertical landing routes render without browser or image errors', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport })
      for (const route of routes) {
        const page = await context.newPage()
        const errors = []
        const failed = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
        page.on('requestfailed', (request) => failed.push(request.url()))
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' })
        assert.equal(response?.status(), 200, `${route} should render HTTP 200`)
        assert.ok(await page.locator('h1').count(), `${route} should have a primary heading`)
        assert.equal(await page.locator('text=/Coming Soon|Coming soon|Launching soon/').count(), 0, `${route} contains generic placeholder copy`)
        const brokenImages = await page.locator('img').evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.getAttribute('src')))
        assert.deepEqual(failed, [], `${route} has failed requests`)
        assert.deepEqual(errors, [], `${route} has browser errors`)
        assert.deepEqual(brokenImages, [], `${route} has broken images`)
        await page.close()
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
})
