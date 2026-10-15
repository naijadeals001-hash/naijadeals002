import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const loader = fileURLToPath(new URL('../tests/payment-engine/helpers/ts-extensionless-loader.mjs', import.meta.url))
const result = spawnSync(process.execPath, [
  '--experimental-transform-types',
  '--experimental-loader',
  loader,
  '--test',
  ...process.argv.slice(2),
], { stdio: 'inherit' })

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)
