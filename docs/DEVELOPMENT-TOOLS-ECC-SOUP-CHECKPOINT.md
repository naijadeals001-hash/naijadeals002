# Development Tools Checkpoint: ECC 2.2.3 + Soup

Date: 2026-10-25
Branch: `feat/naijadrive-private-ride-foundation`
Local HEAD before this documentation batch: `950171589a11574a99a52d24d816062b6a929ff6`

## Executive summary

ECC 2.2.3 is installed and its deterministic tooling is healthy, but the real OpenCode provider-backed planner remains blocked after two bounded initialization-only timeouts. Therefore the complete LLM workflow is not verified. AgentShield now runs through an isolated dependency installation, but its scan is Grade D and requires manual finding validation.

Soup `v0.2.1` was verified from the official repository and its official test suite passed. An isolated six-task proof of concept achieved 100% required-skill recall and deterministic results, but selected irrelevant context for one cross-cutting task. Soup is not integrated because no native OpenCode adapter was found and the caller must own security policy, provenance, conflict handling and fallback.

No NaijaDeals production behavior, deployment configuration, secrets, D1/R2 data, routes, schemas, or OpenCode/REA configuration was changed.

## Status matrix

| Capability | Status | Meaning |
|---|---|---|
| ECC installed | PASS | Official 2.2.3 source and managed OpenCode state verified |
| ECC deterministic plan/consult | PASS | Both official local commands exited 0 |
| ECC real OpenCode planning | BLOCKED | Provider-backed run timed out after init, exit 124, zero output |
| ECC implementation/testing/review/security through OpenCode | BLOCKED | Downstream stages were not fabricated |
| AgentShield execution | PARTIAL | Isolated install succeeded; scan returned Grade D / exit 2 |
| Soup project verification | PASS | Official repo, v0.2.1, MIT, Python >=3.12 |
| Soup official tests | PASS | 141 passed |
| Soup isolated POC | PASS | Six tasks, five repeated selections each |
| Soup production integration | NOT RUN | Deliberately not integrated |
| REA version/config preservation | PASS | 6.7.0 and OpenCode MCP registration aligned |
| REA full doctor | PARTIAL | Optional native engines and unrelated Claude registration unavailable |
| Production readiness | NOT READY | Outstanding provider and security governance blockers |

## Evidence and commands

### Repository preservation

- NaijaDeals worktree: `/home/user/worktrees/release-naijaeats-phase1`
- Branch: `feat/naijadrive-private-ride-foundation`
- Existing untracked `.npm-cache-rea/` remains preserved and unstaged.
- `/home/user/webapp` was not modified.
- No reset, clean, stash, revert, force-push, deploy or production data mutation was performed.

### ECC

```bash
cd /home/user/tools/ECC
node scripts/doctor.js --target opencode --json
node scripts/ecc.js plan --profile core --target opencode --json
node scripts/consult.js 'TypeScript implementation testing code review security review' --target opencode --json
```

All three local commands passed. A bounded real workflow was attempted twice against `/tmp/ecc-poc.6iPy8L` using `opencode run --agent planner --command plan`; both reached OpenCode initialization and timed out with exit `124`. Evidence: `/tmp/ecc-plan-attempt-rerun.err` and empty `/tmp/ecc-plan-attempt-rerun.json`.

### AgentShield

- Isolated package dependencies: `/tmp/ecc-agentshield-deps`
- Scan output: `/tmp/ecc-agentshield-scan-final.txt`
- Result: Grade D `(59/100)`, 133 findings, 32 critical, 0 high, 48 medium, 46 low, 7 info, 16 auto-fixable.
- Critical matches are Azure storage-key patterns in ECC `package-lock.json`; they remain unclassified and were not auto-fixed.
- ECC supply-chain IOC scan passed over 227 files.

### REA

```bash
NPM_CONFIG_CACHE=/home/user/worktrees/release-naijaeats-phase1/.npm-cache-rea \
  npx --offline --yes rea-agents@6.7.0 --version
```

Returned `6.7.0`. The REA doctor identified the OpenCode registration at `/home/user/.config/opencode/opencode.jsonc` as `aligned`, with the skill state aligned and 207 MCP tools catalogued. It exited `1` because Hopper, Ghidra, IDA, JADX and Kuna are not configured and a Claude Code registration is missing. No new REA reference capture was required or claimed for this tooling task.

### Soup

Official checkout: `/tmp/soup-official`

```text
remote: https://github.com/southwind-ai/soup.git
tag: v0.2.1
commit: ba8d72e3a4f3283d0c06a9df6154e6b3af7892e6
license: MIT
python: >=3.12
```

Isolated environment: `/tmp/soup-poc-venv`. Official test result: `141 passed in 0.50s`.

POC: `/tmp/soup-poc.py`; result: `/tmp/soup-poc-results.json`.

Measured results:

- Required-skill recall: `6/6 = 100%`.
- Determinism: `6/6 tasks` identical over five repetitions.
- Mandatory security instruction preservation: `6/6 = 100%`.
- Irrelevant-selection cases: `1/6`; the cross-cutting task selected two additional related skills.
- Local selection time: roughly `0.09–0.25 ms`; not a production benchmark.
- Failure cases covered: missing skill, Soup unavailable, malformed model, duplicate registration, unsafe content, and conflicting content.

The POC used official `Soup.register`, `Soup.select` and `Soup.build_context` only. It did not use remote skill loading and did not claim an OpenCode adapter.

## Files created or changed

Created in the NaijaDeals documentation tree:

- `docs/DEVELOPMENT-TOOLS-ECC-223.md`
- `docs/DEVELOPMENT-TOOLS-SOUP.md`
- `docs/DEVELOPMENT-TOOLS-ECC-SOUP-CHECKPOINT.md`

The disposable POC and virtual environment remain outside the repository. Existing application files and `.npm-cache-rea/` were not changed. The Control Center Development Registry was not updated: there is no safe reason to create a production task event for an isolated tooling evaluation whose acceptance is partial/blocked.

## Remaining blockers and next actions

1. Diagnose OpenCode provider/model reachability without exposing credentials; rerun the disposable ECC workflow only after a usable provider is confirmed.
2. Validate AgentShield's 32 critical package-lock matches and template findings; rerun before any fix.
3. If Soup remains interesting, expand the golden-task set and create an opt-in, local-allowlist-only adapter experiment outside production.
4. Keep mandatory security instructions outside Soup-selected content and fall back to the fixed baseline on any routing error.
5. Do not mark ECC or Soup production-ready until the blocked workflow and security governance gates pass.
