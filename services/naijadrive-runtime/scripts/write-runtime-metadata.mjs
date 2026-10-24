import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const output = resolve(new URL('../dist/runtime-metadata.json', import.meta.url).pathname)
let gitSha = process.env.NAIJADRIVE_GIT_SHA || 'unknown'
try {
  gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(new URL('..', import.meta.url).pathname) }).toString().trim()
} catch {
  // A source archive may not include .git; the caller can provide the SHA explicitly.
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify({ service: 'naijadrive-runtime', git_sha: gitSha, build_time: new Date().toISOString() }, null, 2)}\n`)
console.log(`NaijaDrive runtime metadata: ${gitSha}`)
