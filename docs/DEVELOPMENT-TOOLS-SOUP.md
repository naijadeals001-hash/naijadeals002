# Soup Skill-Routing Proof of Concept

Date: 2026-10-25
Candidate: `https://github.com/southwind-ai/soup`

## Executive status

| Area | Status | Evidence |
|---|---|---|
| Exact repository verification | PASS | `/tmp/soup-official`, official remote, tag `v0.2.1` |
| Release/commit/license verification | PASS | `v0.2.1`, commit `ba8d72e3a4f3283d0c06a9df6154e6b3af7892e6`, MIT |
| Isolated installation | PASS | `/tmp/soup-poc-venv`, editable official checkout, `soup-ai 0.2.1` |
| Official test suite | PASS | `141 passed in 0.50s` |
| Skill-routing POC | PASS | `/tmp/soup-poc.py`, six fixed tasks, five repeated selections per task |
| Safety wrapper/fallback tests | PASS | Missing, unavailable, malformed, duplicate, unsafe and conflicting cases exercised |
| Native OpenCode adapter | NOT RUN / NOT FOUND | No native adapter was documented or present in the inspected release |
| NaijaDeals integration | NOT RUN | Intentionally isolated; no application or OpenCode integration performed |
| Production readiness | NOT READY | Routing quality and security governance still require caller-owned controls |

## Project verification

The exact requested project is the official `southwind-ai/soup` repository. The checkout at `/tmp/soup-official` was verified at tag `v0.2.1` and commit `ba8d72e3a4f3283d0c06a9df6154e6b3af7892e6`. The project is MIT licensed and describes itself as a provider-agnostic Agent Skills router.

Official package metadata:

- Package: `soup-ai`
- Python: `>=3.12`
- Runtime dependencies: `pydantic>=2.6,<3`, `pyyaml>=6.0`
- Default strategy: `BM25Strategy`
- Public API used: `Soup.register`, `Soup.select`, `Soup.build_context`
- Message helper: `Soup.prepare`

The source was inspected before use, including the frozen/strict `Skill` model, BM25 searchable fields, dependency/inheritance resolver, local/remote skill loaders, and message-context injection. Remote loading uses HTTP sources; this POC used only in-memory local `Skill` objects.

## POC design

The POC was created outside the NaijaDeals worktree at `/tmp/soup-poc.py` and executed in `/tmp/soup-poc-venv`. It registered five representative mock skills:

1. NaijaDrive ride dispatch, expiry, reassignment and recovery.
2. NaijaEats courier eligibility, fulfillment, pickup, delivery and proof of delivery.
3. Control Center RBAC with country/city scope.
4. NaijaPay payment security, amount validation and idempotency.
5. Cloudflare D1 migrations and safe rollback planning.

A sixth cross-cutting task intentionally exercised overlap across payment, RBAC, migration, Drive and Eats vocabulary. The baseline was a fixed manually selected list for each task. Soup selection was compared to that fixed required set; the POC added a caller-owned mandatory security instruction to every generated context.

The POC did not modify routes, schemas, D1, R2, deployment configuration, OpenCode configuration, or production behavior.

## Measurements

Environment: Python `3.13.14`, Soup `0.2.1`, local in-memory execution.

Results across six fixed tasks and five repeated selections per task:

- Required-skill recall: `100%` (`6/6` tasks retained all required skills).
- Determinism: `100%` (`5/5` identical selections for every task).
- Mandatory security instruction retained: `100%` (`6/6` contexts).
- Tasks with irrelevant selections: `1/6` (the cross-cutting query selected two extra skills).
- Cross-cutting result: five skills selected for three required skills; useful recall, but lower precision.
- Selection runtime: approximately `0.09–0.25 ms` per query in this small local fixture; this is not a production benchmark.
- Context size: measured as Python character count in the POC, not tokens. No token-saving claim is made.

Observed single-domain selections were precise: Drive, Eats, RBAC, payment, and database tasks each selected the expected skill only. The cross-cutting result confirms the tradeoff: BM25 vocabulary routing can surface related context, but it does not understand authorization boundaries or decide whether extra instructions are safe.

## Failure and security tests

The POC exercised the following:

- Missing skill/query with no Soup match: selected the fixed baseline and preserved the mandatory security instruction (`fallback:no-selection`).
- Soup unavailable: passed `None` to the caller-owned router and deterministically selected the fixed baseline (`fallback:soup-unavailable`).
- Malformed skill: the official Pydantic model rejected an unexpected field with `ValidationError`.
- Duplicate registration: measured the public behavior; the registration call did not raise. This means callers should validate names and provenance rather than assume duplicate rejection.
- Unsafe skill content: a skill containing an instruction to ignore authorization was not selected for the test query; the mandatory instruction still remained. This is a test observation, not a safety guarantee.
- Conflicting instruction content: a skill attempting to make admin routes public was not selected for the test query; the mandatory instruction still remained. Soup itself does not establish a privileged trust boundary.
- Secret exposure: the POC contained no credentials, printed no environment variables, and used no remote skill source.

The safety wrapper is deliberately outside Soup. It preserves mandatory project/security constraints, uses a fixed baseline when routing is unavailable or empty, and treats selected skill text as untrusted input. In a real workflow, security instructions must be injected from a trusted application-controlled source after selection, not stored only inside selectable skills.

## Suitability and recommendation

**Recommendation: do not integrate Soup into OpenCode or NaijaDeals yet.**

Soup is technically suitable as a small, provider-neutral context router. The isolated result is promising for deterministic local selection, especially for domain-specific task vocabulary. However:

- No native OpenCode adapter was found in `v0.2.1`; integration would require a separately maintained adapter or wrapper.
- BM25 selection is lexical, not authorization-aware.
- The caller must enforce trusted skill provenance, mandatory instructions, conflict policy, duplicate handling and fallback.
- Remote skill loading introduces supply-chain and content-integrity concerns unless refs are pinned and content is reviewed.
- The test fixture is small and synthetic; it does not establish production accuracy or token savings.

The smallest safe next step, if desired, is a non-production adapter experiment that accepts an OpenCode task description, selects only from a versioned local allowlist, appends a fixed trusted security baseline, logs only skill names and hashes, and falls back to the existing fixed context on any error. It should remain behind an opt-in feature flag and pass a larger golden-task evaluation before any developer workflow adoption.
