#!/usr/bin/env node
/**
 * Development-only NaijaDrive source/artifact gate.
 * Unlike scripts/verify_deployment.cjs, this deliberately does not require
 * HEAD == origin/main and never contacts or deploys a production host.
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const runtimeDir = path.join(repoRoot, 'services', 'naijadrive-runtime')
const expectedSha = process.argv[2] || process.env.EXPECTED_NAIJADRIVE_SHA
if (!expectedSha || !/^[0-9a-f]{40}$/i.test(expectedSha)) {
  console.error('Usage: node scripts/verify_naijadrive_preview.cjs <40-character-commit-sha>')
  process.exit(2)
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const head = run('git', ['rev-parse', 'HEAD'], repoRoot)
if (head !== expectedSha) throw new Error(`HEAD ${head} does not equal intended SHA ${expectedSha}`)
if (run('git', ['status', '--porcelain'], repoRoot)) throw new Error('Working tree is dirty')
run('npm', ['run', 'build'], runtimeDir)
const metadataPath = path.join(runtimeDir, 'dist', 'runtime-metadata.json')
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
if (metadata.git_sha !== expectedSha) throw new Error(`Runtime metadata SHA ${metadata.git_sha} does not equal ${expectedSha}`)
console.log(JSON.stringify({ verified: true, source_sha: head, artifact_sha: metadata.git_sha, runtime: runtimeDir }, null, 2))
