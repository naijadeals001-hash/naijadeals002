import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const baselinePath = path.join(root, 'scripts', 'tsc-baseline.json')
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))

function normalize(message) {
  return message.replace(/\s+/g, ' ').trim()
}

function parseDiagnostics(output) {
  const diagnostics = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(.*?)\(\d+,\d+\): error (TS\d+): (.*)$/)
    if (!match) continue
    diagnostics.push({
      file: match[1],
      code: match[2],
      message: normalize(match[3]),
    })
  }
  return diagnostics
}

function key(diagnostic) {
  return JSON.stringify(diagnostic)
}

const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], {
  cwd: root,
  encoding: 'utf8',
})
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
const current = parseDiagnostics(output)
const baselineMap = new Map(baseline.map((diagnostic) => [key(diagnostic), diagnostic]))
const currentMap = new Map(current.map((diagnostic) => [key(diagnostic), diagnostic]))
const newDiagnostics = [...currentMap.values()].filter((diagnostic) => !baselineMap.has(key(diagnostic)))
const resolvedDiagnostics = [...baselineMap.values()].filter((diagnostic) => !currentMap.has(key(diagnostic)))

console.log(`TypeScript command exit: ${result.status ?? 1}`)
console.log(`Baseline diagnostics: ${baselineMap.size}`)
console.log(`Current diagnostics: ${currentMap.size}`)
console.log(`New diagnostics: ${newDiagnostics.length}`)
console.log(`Resolved baseline diagnostics: ${resolvedDiagnostics.length}`)

if (newDiagnostics.length > 0) {
  console.error('New TypeScript diagnostics detected:')
  for (const diagnostic of newDiagnostics) console.error(`${diagnostic.file} ${diagnostic.code}: ${diagnostic.message}`)
  process.exit(1)
}

if ((result.status ?? 1) !== 0) {
  console.log('Existing baseline TypeScript errors remain; no new diagnostics were introduced.')
}
process.exit(0)
