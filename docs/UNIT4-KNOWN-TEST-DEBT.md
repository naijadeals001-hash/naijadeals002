# Unit 4 — Known Test Debt (documented, NOT fixed per Pat's explicit instruction)

Per the Unit 4 delivery rule: "If an existing test still expects obsolete UI
text, document it as stale test debt rather than changing production UI
solely to satisfy that assertion." Two pre-existing test failures were found
during Unit 4 regression testing against the migrated (0064) local D1. Both
were root-caused to real, harmless test-authoring gaps — NOT application
defects. Neither the application UI nor the test assertions were modified,
per the explicit "do not weaken tests to get PASS" / "do not revert UI to
satisfy stale tests" instructions.

## 1. `tests/control-center/01.authentication.test.mjs` — AUTH-OK-9

**Assertion:** `res.raw.includes('Platform Overview')`

**Reality:** The Control Center dashboard was intentionally redesigned; its
current heading is "Operations Tower" (src/routes/control-center.tsx:808).
The string "Platform Overview" does not exist anywhere in the current
control-center.tsx and has not since the redesign (confirmed via `git log -p`
on the file's full history — no commit ever reverted it back).

**Verified manually** (see conversation — direct HTTP call after real login):
- `GET /control-center` → 200
- Response is NOT the login page (`cc-login-form` absent)
- Response includes "Operations Tower" (the current real heading)
- `<title>Command Center | Control Center | NaijaDeals</title>`

**Conclusion:** the dashboard is genuinely accessible and renders real,
correct markup. The test's string literal predates the intentional redesign
and was never updated. Stale test debt — recommend updating the assertion
to check for "Operations Tower" (or a redesign-agnostic marker like the
`cc-login-form` absence check that's already present) in a dedicated,
non-Unit-4 test-maintenance pass.

## 2. `tests/control-center/04.verification-e2e.test.mjs` — E2E-1

**Assertion:** `!queueAfter.raw.includes(vendor.slug)` checked against the
FULL page HTML after verifying a pending vendor.

**Reality:** `GET /control-center/vendors` renders TWO distinct sections:
1. "Vendor Verification Queue" — pending-only, confirmed CORRECTLY excludes
   the vendor once verified (manually isolated this section's HTML and
   verified the slug is absent — the actual queue behavior works exactly as
   intended).
2. "All Vendors & Stores" — a separate, intentional directory table listing
   ALL vendors regardless of verification status (added after this test was
   originally written). The test fixture's `business_name` is
   `${slug} Ltd`, which legitimately embeds the vendor's slug — so the now-
   verified vendor correctly still appears in this directory section.

The test's page-wide substring check does not distinguish between the two
sections, so it fails on a legitimate, correct feature (the directory table)
rather than detecting any real staleness in the pending queue.

**Verified manually:** pending-section-only HTML slice excludes the vendor
slug after verification (`pendingSection.includes(vendor.slug) === false`);
directory-section-only HTML slice includes it (`directorySection.includes(
vendor.slug) === true`) — exactly the correct, intended behavior.

**Conclusion:** stale test assertion scope, not an application defect.
Recommend scoping the assertion to the pending-queue table only (e.g. slice
the HTML at the "All Vendors" heading, mirroring the manual verification
done here) in a dedicated, non-Unit-4 test-maintenance pass.

## Test suite results (excluding the two documented items above)

- Booking Engine: 55/55 PASS
- Notification Engine: 73/73 PASS (across all 8 files, each run per its
  documented PRECONDITION/Run command)
- Control Center: 69/71 PASS (2 documented above)
- Identity Engine: see Unit 4 Final Delivery Report

No test assertions were weakened. No application UI was changed to chase a
stale test string. Both items are pre-existing test debt, unrelated to the
0042-0064 migration or any Unit 4 code change.
