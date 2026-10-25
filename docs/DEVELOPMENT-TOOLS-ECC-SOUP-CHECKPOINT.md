# Development Tools Checkpoint: ECC 2.2.3 + Soup

Date: 2026-10-25
Branch: `feat/naijadrive-private-ride-foundation`
Local HEAD before this documentation batch: `950171589a11574a99a52d24d816062b6a929ff6`

## Executive summary

ECC 2.2.3 is installed and its deterministic tooling is healthy, but the real OpenCode provider-backed planner remains blocked after two bounded initialization-only timeouts. Therefore the complete LLM workflow is not verified. AgentShield now runs through an isolated dependency installation, but its scan is Grade D and requires manual finding validation.

Soup `v0.2.1` was verified from the official repository and its official test suite passed. An isolated six-task proof of concept achieved 100% required-skill recall and deterministic results, but selected irrelevant context for one cross-cutting task. Soup is not integrated because no native OpenCode adapter was found and the caller must own security policy, provenance, conflict handling and fallback.

No NaijaDeals production behavior, deployment configuration, secrets, D1/R2 data, routes, or schemas were changed. A reversible shared OpenCode instruction-path update was made outside the repository and backed up before modification; the existing REA registration was preserved.

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

## Follow-up checkpoint — 2026-10-25

### ECC provider diagnosis

OpenCode `1.18.18` was tested with explicit `openai/gpt-4.1`, `opencode/big-pickle`, and `anthropic/claude-haiku-4-5` models, plus `--pure` with the Anthropic model. All runs loaded configuration, reached `init`, timed out between 45 and 75 seconds, and produced zero output. An independent minimal request to the configured Anthropic-compatible endpoint returned HTTP 200 and `OK` in approximately 2.5 seconds. The OpenAI-compatible endpoint returned HTTP 400 for the test model because it was not allowed. The current blocker is therefore narrowed to OpenCode request dispatch/provider integration; no credentials or TLS settings were changed. ECC remains **BLOCKED** for LLM-backed workflow acceptance.

### AgentShield disposition

The scan was reproduced at Grade D `(59/100)` before the global policy update, then final-rescanned afterward at Grade D `(58/100)`: 133 → 134 findings, 32 critical, 0 high, 48 → 49 medium, 46 low, and 7 info. All 32 critical findings are `integrity` fields in `/home/user/.config/opencode/package-lock.json`; each is an npm `sha512-...` integrity digest. They are classified as scanner false positives, not Azure credentials. The lockfile was not changed and `--fix` was not run. The new medium finding reports the shared global instruction file is outside the repository and is retained as an expected shared-policy condition. Other medium and low findings concerning example prompt-injection content, inline hooks, template MCP URLs, auto-install/unversioned packages, broad environment inheritance, missing timeouts, and hook coverage remain open. AgentShield remains **PARTIAL**, not a security approval.

### Soup token benchmark

A direct provider benchmark used the same Anthropic-compatible model, task wording, mandatory security baseline, and six representative tasks:

| Workflow | Provider input | Cache creation | Cache read | Output | Total input accounting |
|---|---:|---:|---:|---:|---:|
| Fixed all-five-skill context | 24 | 3,276 | 0 | 1,536 | 3,300 |
| Soup-selected context | 1,564 | 0 | 0 | 1,536 | 1,564 |

Soup reduced provider-reported input accounting by 52.6% and total input-plus-output token accounting by 35.9% in this small six-call run. No currency cost was claimed because pricing metadata was not independently verified. Soup required-skill recall was 5/6 in this benchmark: the cross-cutting task omitted the required database migration skill. This omission prevents adoption despite measurable context reduction.

### Global policy and project verification

The shared policy is now loaded through:

```text
/home/user/.config/opencode/instructions/DEVELOPMENT-TOOLS-GLOBAL-POLICY.md
```

A backup exists at `/tmp/opencode.json.pre-global-tools-20261025`. The reusable acceptance helper is `/home/user/.config/opencode/tools/verify-global-development-tools.mjs`.

Verified accessible projects:

| Project | REA | ECC | Soup | Notes |
|---|---|---|---|---|
| NaijaDeals worktree | PARTIAL | PASS for installation/deterministic checks; LLM workflow BLOCKED | PARTIAL | Tooling-documentation batch is dirty until commit; preserved `.npm-cache-rea/` remains excluded |
| `/home/user/webapp` | PARTIAL | PASS for shared installation/deterministic checks | PARTIAL | Existing dirty changes preserved; no files modified |

The global policy does not falsely mark either project fully compliant. Soup remains an isolated candidate and REA remains provider-limited.
