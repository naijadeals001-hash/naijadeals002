# D1-001 Historical SQL Binding Error Investigation

Date: 2026-10-25
Repository: `https://github.com/naijadeals001-hash/naijadeals002.git`
Branch: `feat/naijadrive-private-ride-foundation`

## Executive status

| Error | Status | Result |
|---|---|---|
| `18 values for 17 columns` | PARTIAL | Historical source path was traced to the Development Registry seed/alignment defect already fixed in the CC-003 batch; a fresh malformed-row repair regression now passes. The exact historical runtime error was not re-triggered against the already-fixed code. |
| `Wrong number of parameter bindings for SQL query` | NOT REPRODUCED | Historical stack evidence was captured, but no current source path produced the error during the bounded tests and preview observation. No speculative SQL change was made. |
| Fresh PM2 runtime observation | PASS | Existing preview stayed online; exercised routes returned expected responses and added zero PM2 error-log lines. |
| Relevant booking-engine exercise | BLOCKED | Local fixtures returned `Listing vertical is not configured` / HTTP 409 before reaching the suspected booking SQL path. This is a rollout-fixture precondition failure, not evidence of a binding defect. |

No production D1 database, deployment, DNS, secrets, or remote runtime was changed.

## Observation window

The existing PM2 process was reused:

```text
Process: naijadeals
Status: online
PID: 100972 at initial inspection
Working directory: /home/user/worktrees/release-naijaeats-phase1
Command: wrangler pages dev dist --d1=naijadeals-production --local --ip 0.0.0.0 --port 3000
```

Historical PM2 errors were recorded before exercising routes. The existing error log contained older entries at Wrangler log timestamps including:

- `2026-10-25_06-51-08_560.log`: `D1_ERROR: 18 values for 17 columns`.
- `2026-10-25_08-29-14_672.log`: `D1_ERROR: Wrong number of parameter bindings for SQL query`.
- `2026-10-25_09-36-35_070.log`: a repeated `Wrong number of parameter bindings for SQL query`.

These were kept separate from new evidence. The error log was not deleted or rotated.

Fresh observation window:

```text
Start: 2026-10-25T17:21:17+00:00
End:   2026-10-25T17:21:17+00:00
PM2 error lines before: 665
PM2 error lines after:  665
New error lines: 0
```

Responses from the existing preview:

| Request | Response |
|---|---:|
| `GET /` | 200 |
| `GET /drive` | 200 |
| `GET /eats` | 200 |
| `GET /control-center/development` | 302, existing authentication boundary |
| `GET /api/control-center/development/summary` | 401, existing protection |
| `GET /api/drive/driver/offers` | 401, existing protection |

## Error 1 — `18 values for 17 columns`

### Source trace

The repository history identifies the Development Registry seeding path as the implicated defect. The earlier implementation in `b8428da` inserted seed rows into a 26-column `cc_development_tasks` statement without normalizing legacy rows whose literal shape was shorter or shifted. The subsequent CC-003 commit `5978b96` added the historical-defect guard and explicitly documented the observed `18 values for 17 columns` symptom.

Current path:

```text
src/lib/control-center-development.ts: ensureDevelopmentBacklog()
migrations/0095_control_center_development_registry.sql: cc_development_tasks schema
```

The current implementation:

- Normalizes legacy row shape before binding.
- Requires exactly 26 values per task row.
- Converts route/screenshot fields into JSON arrays.
- Repairs existing rows only when route/screenshot fields have the malformed non-array signature.
- Records a repair event through the existing Development Registry event table.

### Reproduction

A fresh local D1 fixture inserted a deliberately malformed `CC-001` row with:

```text
preview_routes_json = 'not-json'
screenshot_refs_json = 'not-json'
```

Then it called the real `ensureDevelopmentBacklog()` path. The repair completed without either historical D1 error, and the repaired fields were valid JSON arrays.

Regression test:

```text
tests/control-center-cc003.test.mjs
  D1-001 malformed registry rows are repaired without binding errors
```

Result: **PASS**.

The test also exposed that empty legacy route/screenshot values were not being normalized to JSON arrays. That was a real adjacent data-shape defect, so the smallest fix was made in `src/lib/control-center-development.ts` to normalize empty strings as `[]`. No authorization, audit, rollout, or transaction boundary was changed.

### Conclusion

The historical `18 values for 17 columns` path is **PARTIAL**, not newly fixed by TS-001. The source-backed remediation already exists in the CC-003 implementation, and the current repair path is now regression-covered. The exact historical runtime error was not reproduced against the corrected code, so no claim is made that every historical occurrence has been eliminated.

## Error 2 — `Wrong number of parameter bindings for SQL query`

### Source trace

The historical PM2 stack identifies a bundled D1 execution path but does not retain source maps or route metadata sufficient to identify the exact application caller. Current source and migration searches covered:

- Application `INSERT`, `UPDATE`, `SELECT`, and `.bind(...)` sites.
- Development Registry seed and repair paths.
- Booking hold and booking lifecycle SQL.
- NaijaEats order and fulfillment SQL.
- NaijaDrive ride and offer SQL.
- Control Center audit and registry event SQL.
- Migration and seed SQL with explicit column/value lists.

No current application statement could be proven to have a placeholder/bind count mismatch from the available source and bundle evidence.

### Reproduction attempts

The following bounded local tests were exercised:

- CC-003 Development Registry and malformed-row repair.
- TS-001 focused integrated matrix, including Control Center, Drive, Eats and Shop paths.
- Booking Engine creation, state, availability and concurrency paths.
- Existing preview routes in the fresh PM2 observation window.

The current Development Registry repair path passed without the error. The booking suite did not reach its intended hold/booking SQL paths because its local fixtures were rejected earlier by the rollout guard with:

```text
Listing vertical is not configured
HTTP 409
```

This is a test-fixture/configuration precondition failure. It is not evidence that the booking SQL binding error is fixed or caused by booking SQL.

No source change was made for this error because the cause was not proven.

### Conclusion

Status: **NOT REPRODUCED**.

The historical error remains an open investigation item. The next useful step is to repair or explicitly provision the local booking test vertical/rollout fixture, rerun the booking paths, and capture the response body plus fresh PM2 logs. That should occur before changing any booking SQL.

## Verification results

### TypeScript and build

```text
npm run test:ts-baseline
PASS — baseline diagnostics 9, current diagnostics 0, new diagnostics 0

npm run build
PASS — 272 modules
```

### Focused regression results

```text
npm run test:node -- tests/control-center-cc003.test.mjs
PASS — 4/4

Previous TS-001 focused integrated matrix
PASS — 28/28 in the current rerun before D1-specific changes
```

### Booking engine result

The bounded booking-engine run was **BLOCKED/PARTIAL**, not reported as a pass:

- 15 tests executed across creation/state/availability/concurrency files.
- 2 passed.
- 13 failed at the fixture setup boundary with HTTP 409.
- Primary failure: `Listing vertical is not configured`.
- No D1 binding error was observed in that run.

### Browser acceptance

Browser acceptance was not required for the source-level Development Registry repair path. The affected preview pages and protected APIs were checked over HTTP. No browser-specific SQL workflow claim is made.

## Development Registry update

`src/lib/control-center-development.ts` now includes `D1-001` with status `PARTIAL`. It records:

- The historical registry seed/alignment path.
- The passing malformed-row repair test.
- The unreproduced second binding error.
- The booking fixture rollout blocker.

It was intentionally not marked `COMPLETE`.

## Residual uncertainty and next task

1. The exact caller for the historical generic binding error remains unknown.
2. The old PM2 bundle/source-map relationship is unavailable, so stack offsets cannot be mapped conclusively to a current source file.
3. The booking test fixture must provision a valid configured vertical before its SQL paths can be evaluated.
4. Historical PM2 errors may include failures from older builds or stale local D1 state.
5. No production claim is made.

Recommended next task: fix the isolated booking test rollout precondition only, rerun the booking-engine D1 paths, and inspect fresh logs for the generic binding error before considering any SQL modification.
