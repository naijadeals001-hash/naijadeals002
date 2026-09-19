# Stage 2C — Known Test Debt & Pre-Existing Environment Findings (documented, NOT fixed per Pat's explicit instruction)

Stage 2C's governing rule: "the job is to prove it, not expand it." Per Pat's
explicit instructions this unit, none of the items below were fixed —
neither application code nor test assertions were modified to force a
pass, and no pre-existing environment debris outside Stage 2C's own test
runs was cleaned up. This file documents what was found, how it was
root-caused, and why it is excluded from Stage 2C remediation.

## 1. Local D1 — 7 pre-existing foreign-key violations (untouched)

**Finding:** `PRAGMA foreign_key_check` against the local D1 database
(`naijadeals-production`, `.wrangler/state/v3/d1`) returns 7 rows:

```
notification_outbox|4|users|0
notification_outbox|5|users|0
notification_outbox|6|users|0
notification_outbox|7|users|0
notification_outbox|14|users|0
notification_outbox|15|users|0
notification_outbox|16|users|0
notifications|4|users|0
notifications|5|users|0
notifications|6|users|0
notifications|7|users|0
notifications|14|users|0
notifications|15|users|0
notifications|16|users|0
```

**Root cause:** `notification_outbox.recipient_user_id` /
`notifications.user_id` reference user ids 4, 5, 6, 7, 14, 15, 16 — but the
`users` table's current `MIN(id)` is **45**. These users were deleted by an
earlier, unrelated cleanup unit that predates this session (git history and
test-file `git status` confirm zero Stage 2C or Control Center test changes
that could explain rows referencing ids this low). They are not reachable
by, or related to, any Stage 2C code path.

**Decision (Pat, explicit):** Leave them alone. Do not clean them as a
"bonus" while already touching the database — modifying unrelated
historical data outside the authorized scope is exactly the kind of
scope-creep this unit's governing principle forbids. Confirmed: these are
NOT a production blocker unless independently found to exist in the
production D1 during the Phase 10 migration preflight; local test-harness
debris is not evidence of a production defect.

**Status:** `Known pre-existing local test-environment FK violations: 7
rows. Not introduced by Stage 2C. Excluded from Stage 2C remediation.`

## 2. Control Center 01 — AUTH-OK-9 (confirmed stale test assertion)

**Assertion:** `res.raw.includes('Platform Overview')`

**Reality:** Already documented in commit `c78b54e` (predates this
session, Unit 4): the Control Center dashboard was intentionally redesigned
and its current heading is "Operations Tower"
(`src/routes/control-center.tsx:808`). "Platform Overview" does not exist
anywhere in the file.

**Independently re-verified this session** via a manual login → dashboard
HTTP round-trip outside the test runner:
- `GET /control-center` after real login → `200`
- Response is genuinely the Control Center shell (`<title>Command Center |
  Control Center | NaijaDeals</title>`), not the login page
  (`cc-login-form` absent)
- Content matches the pre-existing documented conclusion exactly

**Conclusion:** the application is correct; the test string predates an
intentional redesign and was never updated. Not touched, per instruction.
See `docs/UNIT4-KNOWN-TEST-DEBT.md` §1 for the original root-cause writeup.

## 3. Control Center 04 — E2E-1 (confirmed stale test assertion scope)

**Assertion:** `!queueAfter.raw.includes(vendor.slug)` checked against the
FULL `/control-center/vendors` page after verifying a pending vendor.

**Reality:** Already documented in commit `c78b54e`: the page legitimately
renders two sections — a pending-only Verification Queue (correctly
excludes the now-verified vendor) and a separate All Vendors & Stores
directory (correctly still lists every vendor regardless of verification
status, added after this test was originally written). The page-wide
substring check doesn't distinguish the two sections.

**Conclusion:** stale test assertion scope, not an application defect. Not
touched, per instruction. See `docs/UNIT4-KNOWN-TEST-DEBT.md` §2 for the
original root-cause writeup (same defect, re-confirmed this session against
the current codebase).

## 4. Control Center 05 — STEP2-15 (transient test-infrastructure flake, resolved by re-run)

**First run:** `STEP2-15: a role WITH catalog.manage (platform_admin) can
remove a product from a collection` failed with a subprocess error:

```
Command failed: npx wrangler d1 execute naijadeals-production --local --json
--command=INSERT INTO collections (...) VALUES (...) RETURNING id
```

**Investigation:** the `collections` table schema was manually verified —
the exact same INSERT statement, run manually via `wrangler d1 execute`,
succeeded immediately. Re-running the test in isolation
(`--test-name-pattern="STEP2-15"`) passed. Re-running the entire 38-test
file from scratch passed 38/38 with zero failures.

**Conclusion:** a transient failure under the CLI-subprocess load 37
concurrent `wrangler d1 execute` invocations create in one file run —
test-infrastructure flakiness, not a deterministic defect, and not a Stage
2C regression (`tests/control-center/05.step2-orphan-routes-authz.test.mjs`
is confirmed unmodified by `git status --short` throughout this session).

## 5. Test-authoring gap — `tests/control-center/04.verification-e2e.test.mjs` and `05.step2-orphan-routes-authz.test.mjs` have no cleanup hooks

Same class of gap already identified in `tests/search-engine/02.*` and
`07.*` (see prior Stage 2C conversation record): these Control Center test
files create real fixture rows (vendors `cctest-vendor-%`, users
`cctest_%@test.ng`, products `cctest-step2-product-%`, collections
`cctest-step2-collection-%` / `step2-collection-create-%`, category
attributes `cctest_step2_attr_%`, orders `CCTEST-STEP2-%`, and their
downstream disputes/refunds/wallet/notification rows) with **no
`test.after()` teardown**. This is a genuine, orthogonal test-harness
hygiene gap — not touched or fixed this session (out of Stage 2C scope) —
but flagged here because it was the direct cause of the wider FK-violation
surface (`orders`, `disputes`, `refunds`, `wallet_accounts`,
`wallet_ledger`, `notifications`, `notification_outbox`,
`notification_deliveries`) discovered and manually cleaned during this
session's local-D1 hygiene pass. All of that debris was independently
traced (100% match to `cctest%` / `CCTEST-STEP2-%` naming patterns, zero
exceptions) and removed; see conversation record for the full cleanup
ledger.

## Test suite results (Control Center, this session)

- CC 01 (authentication): 11/12 PASS (1 documented above, §2)
- CC 02 (authorization/RBAC): 9/9 PASS
- CC 03 (audit logging): 6/6 PASS
- CC 04 (verification E2E): 5/6 PASS (1 documented above, §3)
- CC 05 (Step-2 orphan routes): 38/38 PASS (after isolated + full re-run; see §4)

No test assertions were weakened. No application UI was changed to chase a
stale test string. No pre-existing environment debris outside this
session's own test-run fixtures was touched.
