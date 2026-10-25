import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const migration = fs.readFileSync(path.join(root, 'migrations/0087_ecosystem_vertical_assets.sql'), 'utf8')
const rail = fs.readFileSync(path.join(root, 'src/components/MerchandisingRail.tsx'), 'utf8')

const expectedAssets = {
  pay: '/static/categories/phone-accessories.jpg',
  auto: '/static/products/088-bluetooth-car-fm-transmitter.jpg',
  homes: '/static/categories/home-improvement.jpg',
  travel: '/static/categories/travel-accessories.jpg',
  events: '/static/banners/banner-2.jpg',
  learn: '/static/products/026-boys-school-uniform-set.jpg',
  jobs: '/static/categories/office-furniture.jpg',
  health: '/static/products/076-digital-blood-pressure-monitor.jpg',
  farm: '/static/categories/african-agriculture.jpg',
  home: '/static/categories/furniture.jpg',
  beauty: '/static/categories/african-beauty.jpg'
}

test('Batch A maps every reserved ecosystem vertical to a tracked local asset', () => {
  const assets = Object.values(expectedAssets)
  assert.equal(new Set(assets).size, assets.length, 'reserved ecosystem cards must use distinct assets')

  for (const [slug, asset] of Object.entries(expectedAssets)) {
    assert.match(migration, new RegExp(`WHERE slug = '${slug}'`), `missing migration update for ${slug}`)
    assert.match(migration, new RegExp(asset.replaceAll('/', '\\/')), `missing asset mapping for ${slug}`)
    assert.equal(fs.existsSync(path.join(root, 'public', asset.replace('/static/', 'static/'))), true, `missing file for ${slug}: ${asset}`)
  }
})

test('ecosystem cards expose meaningful image alternatives and navigable labels', () => {
  assert.match(rail, /alt=\{`\$\{card\.name\} ecosystem`\}/)
  assert.match(rail, /aria-label=\{`\$\{card\.name\}: \$\{card\.status === 'live' \? card\.cta_label : 'Coming soon'\}`\}/)
  assert.doesNotMatch(rail, /hero_image_desktop\}\s*\n\s*alt=""/)
})
