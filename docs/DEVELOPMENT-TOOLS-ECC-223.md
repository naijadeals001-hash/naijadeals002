# ECC 2.2.3 Verification

Date: 2026-10-25
Repository: `https://github.com/naijadeals001-hash/naijadeals002.git`
Branch: `feat/naijadrive-private-ride-foundation`

## Executive status

| Area | Status | Evidence |
|---|---|---|
| Official ECC source/version | PASS | `/home/user/tools/ECC`, version `2.2.3`, commit `c05b2d6614f62f6db0047669aa4eefb223d478f9` |
| ECC installation health | PASS | `node scripts/doctor.js --target opencode --json` exited `0` |
| Installed component discovery | PASS | `/home/user/.config/opencode/ecc-install-state.json`; OpenCode config contains ECC plugin, 14 instructions, 26 agents, 26 commands |
| Deterministic ECC plan | PASS | `node scripts/ecc.js plan --profile core --target opencode --json` exited `0` |
| Deterministic ECC consultation | PASS | `node scripts/consult.js ... --target opencode --json` exited `0` |
| Real OpenCode LLM planning | BLOCKED | Two bounded runs initialized OpenCode but timed out with exit `124`; output JSON was empty |
| Real implementation/testing/review/security workflow | BLOCKED | No LLM-generated plan means these downstream stages were not honestly executable through OpenCode |
| AgentShield install | PARTIAL | Package-local npm install failed; isolated dependency-prefix install succeeded |
| AgentShield scan | PARTIAL | Scan executed, but returned Grade D and exit `2` |
| Production integration | NOT RUN | ECC remains tooling-only; NaijaDeals runtime and deployment were not changed |

## Installation and configuration evidence

Verified official ECC metadata from the checked-out repository:

- Repository: `https://github.com/affaan-m/ECC.git`
- Release: `v2.2.3`
- Commit: `c05b2d6614f62f6db0047669aa4eefb223d478f9`
- License: MIT
- Installation state: `/home/user/.config/opencode/ecc-install-state.json`
- Managed target: `opencode-home`
- Profile: `full`
- Hook consent: enabled

The effective OpenCode ECC configuration is `/home/user/.config/opencode/opencode.json`. The pre-existing REA registration remains in `/home/user/.config/opencode/opencode.jsonc`; that file was preserved and not rewritten by this workstream.

The installed state reports 22 selected ECC modules. OpenCode discovery exposed the expected workflow agents including `planner`, `tdd-guide`, `code-reviewer`, `security-reviewer`, `build-error-resolver`, and `e2e-runner`. Discovery is evidence of installation, not proof that provider-backed execution works.

## Isolated workflow demonstration

Disposable fixture: `/tmp/ecc-poc.6iPy8L`, containing a harmless TypeScript `add` function and unit-test fixture. It is outside NaijaDeals and was not used for production changes.

Real bounded command:

```bash
opencode run \
  --dir /tmp/ecc-poc.6iPy8L \
  --agent planner \
  --command plan \
  --format json \
  --print-logs \
  --log-level DEBUG \
  'Plan a safe improvement to the add function and its unit test.'
```

Observed result on the rerun:

- Exit: `124` after a 35-second timeout.
- OpenCode loaded `/home/user/.config/opencode/config.json`, `/home/user/.config/opencode/opencode.json`, `/home/user/.config/opencode/opencode.jsonc`, and the user-level `.opencode` files.
- Initialization reached `init`.
- Output JSON size: `0` bytes.
- No inspectable planner response was produced.

This was reproduced safely. The available evidence indicates initialization/configuration succeeded, but provider/model execution did not complete. Credentials and provider secrets were not printed. Because planning did not complete, implementation, automated testing, code review, and security review were **BLOCKED**, not simulated. The deterministic ECC plan and consultation tools are useful local validation, but they are not equivalent to an LLM-backed workflow.

## AgentShield investigation

Verified AgentShield package:

- Package: `ecc-agentshield@1.6.0`
- Repository: `https://github.com/affaan-m/agentshield.git`
- License: MIT
- Tarball integrity was checked before execution.

The first dependency installation in the extracted package layout failed with:

```text
npm error Cannot read properties of null (reading 'edgesOut')
```

The package then failed to start because runtime dependencies such as `smol-toml` were unavailable. No permissions, TLS, or shared npm configuration were changed. A safer isolated-prefix install succeeded in `/tmp/ecc-agentshield-deps` using explicit package versions and `--ignore-scripts --no-audit --no-fund`.

The scan then ran against `/home/user/.config/opencode`:

```text
Grade: D (59/100)
Files scanned: 133
Findings: 133 total — 32 critical, 0 high, 48 medium, 46 low, 7 info
Auto-fixable: 16
```

Score categories were: Secrets `0`, Permissions `81`, Hooks `30`, MCP Servers `90`, Agents `94`. The 32 critical findings were Azure storage-account-key pattern matches in the installed ECC `package-lock.json`. The report only exposed redacted evidence. These may be package-lock/fixture false positives, but they were not automatically dismissed or fixed. The report also identified risky MCP templates/external URLs and permission/hook findings.

AgentShield status is therefore **PARTIAL**, not clean. The next security action is manual validation of the flagged package-lock entries and templates, followed by a rerun. `--fix` was intentionally not used because the findings were not yet classified and automatic edits could damage a managed installation.

Additional checks that passed:

- ECC supply-chain IOC scan: passed; 227 files inspected.
- ECC doctor: passed.
- Deterministic ECC plan and consultation: passed.

These checks do not replace a clean AgentShield result or a completed provider-backed OpenCode security review.

## REA preservation and availability

REA was verified from the preserved project cache:

```bash
NPM_CONFIG_CACHE=/home/user/worktrees/release-naijaeats-phase1/.npm-cache-rea \
  npx --offline --yes rea-agents@6.7.0 --version
```

Result: `6.7.0`.

The MCP registration remains aligned in `/home/user/.config/opencode/opencode.jsonc`:

```json
"rea": {
  "type": "local",
  "command": ["npx", "-y", "rea-agents@6.7.0", "mcp"],
  "enabled": true
}
```

The current REA doctor exited `1` because optional native analysis engines are not installed and one unrelated Claude Code registration is missing. It still reported the OpenCode registration as `aligned`, the REA skill as `aligned`, and catalog metadata with 153 CLI commands and 207 MCP tools. No REA reference operation was required for this local tooling verification, and no new reference evidence is claimed.

The untracked `.npm-cache-rea/` directory remains preserved and unstaged.

## Limitations and next steps

1. Inspect OpenCode provider/model configuration without exposing secrets; confirm whether a usable provider is configured and reachable.
2. If provider execution becomes available, rerun the disposable workflow and capture plan, implementation, tests, review, and security output separately.
3. Validate every AgentShield critical match against package-lock provenance before applying any fix.
4. Keep ECC and AgentShield outside NaijaDeals production code until provider execution and security findings are resolved.

## Follow-up verification: provider diagnosis and AgentShield classification

Date: 2026-10-25

### Provider diagnosis

OpenCode `1.18.18` was re-tested with explicit models and a 45–75 second bound:

| Attempt | Result |
|---|---|
| `openai/gpt-4.1` | `BLOCKED`, exit `124`, 75 seconds, zero output |
| `opencode/big-pickle` | `BLOCKED`, exit `124`, 60 seconds, zero output |
| `anthropic/claude-haiku-4-5` | `BLOCKED`, exit `124`, 60 seconds, zero output |
| `--pure` + `anthropic/claude-haiku-4-5` | `BLOCKED`, exit `124`, 45 seconds, zero output |

Every run loaded the OpenCode and ECC configuration and reached `init`, but emitted no provider request/error and no model output. The same configured Anthropic-compatible endpoint was tested independently with a minimal request and returned HTTP 200 with a valid `OK` response in approximately 2.5 seconds. The OpenAI-compatible endpoint rejected the test model with HTTP 400 because the model was not allowed. This narrows the blocker to OpenCode runtime/provider integration or request dispatch, not general network reachability or invalid Anthropic credentials. No configuration or credentials were changed because the safe correction is not established.

Provider credentials were never printed. No `opencode auth login`, credential rewrite, TLS change, or plugin removal was performed.

### AgentShield critical disposition

The scan was reproduced on `2026-10-25T17:34:41Z` at Grade D `(59/100)`, 133 findings, 32 critical, 0 high, 48 medium, 46 low, and 7 info. After adding the shared policy, a final rescan at `2026-10-25T17:39:03Z` remained failing at Grade D `(58/100)`, 134 findings, 32 critical, 0 high, 49 medium, 46 low, and 7 info. The added medium finding reports that the global instruction file is outside the repository; this is expected for a shared global policy and remains documented rather than suppressed. All 32 critical locations are `integrity` fields in `/home/user/.config/opencode/package-lock.json` at lines `14, 26, 39, 52, 65, 78, 91, 104, 132, 141, 147, 161, 171, 189, 211, 217, 226, 232, 238, 244, 253, 275, 281, 296, 305, 321, 333, 342, 351, 364, 379, 394`.

Each value is an npm `sha512-...` package integrity digest. The scanner is interpreting base64 characters in these integrity digests as Azure storage-key patterns. The values are package integrity metadata, not Azure connection strings, account names, or usable credentials. Disposition for all 32: **false positive, documented; no remediation applied**. The lockfile was not rewritten and AgentShield `--fix` was not used.

Critical finding disposition table:

| ID | Location | Classification | Supporting evidence | Remediation | Residual risk |
|---:|---|---|---|---|---|
| AS-CRIT-01 | `package-lock.json:14` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-02 | `package-lock.json:26` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-03 | `package-lock.json:39` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-04 | `package-lock.json:52` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-05 | `package-lock.json:65` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-06 | `package-lock.json:78` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-07 | `package-lock.json:91` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-08 | `package-lock.json:104` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-09 | `package-lock.json:132` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-10 | `package-lock.json:141` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-11 | `package-lock.json:147` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-12 | `package-lock.json:161` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-13 | `package-lock.json:171` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-14 | `package-lock.json:189` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-15 | `package-lock.json:211` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-16 | `package-lock.json:217` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-17 | `package-lock.json:226` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-18 | `package-lock.json:232` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-19 | `package-lock.json:238` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-20 | `package-lock.json:244` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-21 | `package-lock.json:253` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-22 | `package-lock.json:275` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-23 | `package-lock.json:281` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-24 | `package-lock.json:296` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-25 | `package-lock.json:305` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-26 | `package-lock.json:321` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-27 | `package-lock.json:333` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-28 | `package-lock.json:342` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-29 | `package-lock.json:351` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-30 | `package-lock.json:364` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-31 | `package-lock.json:379` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |
| AS-CRIT-32 | `package-lock.json:394` | False positive | JSON field is npm `integrity`; value begins `sha512-` | None; preserve lockfile | Scanner pattern remains |

Remaining findings are not dismissed globally:

- Medium: example prompt-injection/configuration detections, inline hook payloads, risky/template MCP servers and external URLs, chained hooks, and missing permission configuration.
- Low: template MCP auto-install/unversioned-package warnings, broad environment inheritance, large template MCP surface, missing timeouts, and absent Stop hooks.
- Info: informational/template observations.

Because the remaining findings concern templates and managed hook/configuration surface, the overall scan remains **PARTIAL / Grade D** even after critical false-positive classification. The report is not a clean security approval.

### Global policy

The shared policy is now loaded by the global OpenCode configuration:

```text
/home/user/.config/opencode/instructions/DEVELOPMENT-TOOLS-GLOBAL-POLICY.md
```

The project copy and acceptance helper are documented separately in `docs/DEVELOPMENT-TOOLS-GLOBAL-POLICY.md`. The global configuration was backed up to `/tmp/opencode.json.pre-global-tools-20261025` before adding the policy path. No unrelated OpenCode tools or REA registration were removed.
