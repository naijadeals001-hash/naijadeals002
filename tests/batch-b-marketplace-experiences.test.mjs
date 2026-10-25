import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const index = fs.readFileSync(path.join(root, 'src/index.tsx'), 'utf8')
const shop = fs.readFileSync(path.join(root, 'src/pages/shop.tsx'), 'utf8')
const categories = fs.readFileSync(path.join(root, 'src/pages/categories.tsx'), 'utf8')
const product = fs.readFileSync(path.join(root, 'src/pages/product.tsx'), 'utf8')
const cart = fs.readFileSync(path.join(root, 'src/pages/cart.tsx'), 'utf8')
const gigs = fs.readFileSync(path.join(root, 'src/pages/gigs.tsx'), 'utf8')
const unavailable = fs.readFileSync(path.join(root, 'src/components/UnavailableVerticalState.tsx'), 'utf8')
const assets = ['pay-original.svg', 'jobs-original.svg', 'learn-original.svg', 'events-original.svg']

test('marketplace discovery and commerce templates are registered', () => {
  for (const route of ["app.get('/categories'", "app.get('/categories/popular'", "app.get('/shop'", "app.get('/shop/:slug'", "app.get('/cart'"]) {
    assert.equal(index.includes(route), true, `missing route ${route}`)
  }
  assert.match(shop, /name="q"|q = c\.req\.query\('q'\)/)
  assert.match(shop, /categoryRoot/)
  assert.match(categories, /getCategoryDirectory/)
  assert.match(categories, /directory_image_url/)
  assert.match(product, /add-to-cart-btn/)
  assert.match(cart, /cart-qty-plus/)
  assert.match(cart, /cart-remove-btn/)
})

test('shared service journeys and honest unavailable state are wired', () => {
  for (const marker of ['/gigs/providers/', '/gigs/listings/', '/gigs/request', 'api-service-requests']) {
    assert.equal((gigs + index).includes(marker), true, `missing service journey marker ${marker}`)
  }
  assert.match(unavailable, /not available for transactions yet/)
  assert.match(unavailable, /fake checkout/)
})

test('dedicated Batch B vertical assets are real tracked files', () => {
  for (const asset of assets) {
    assert.equal(fs.existsSync(path.join(root, 'public/static/ecosystem', asset)), true, `missing ${asset}`)
  }
})
