# Engine 9 — Communication & Notification Engine: Final Audit

**Status:** COMPLETE / VERIFIED (pending push — see §34)
**Checkpoint commit (post-fix, pre-doc):** `99db15c`
**This document's own commit:** recorded in §34 after commit
**Branch:** `main`
**Date:** 2026-09-13

This document is evidence-based. Every number in it comes from an actual
command executed in this session, not from memory or historical
assumption. Where a claim could not be independently verified, it is
labeled `NOT PERFORMED / BLOCKED` rather than assumed.

---

## 1. Executive Summary

Engine 9 adds a durable, idempotent, financially-safe notification
pipeline to NaijaDeals: a business event (registration, payment,
refund, order-item status change, booking status change) is recorded
once in a durable outbox, fanned out to per-channel delivery rows
(in-app / email / SMS / push), rendered through a safe, versioned
template system, and dispatched through an abstracted provider layer
that uses ONLY a deterministic test adapter — no real email/SMS/push
credentials exist anywhere in this environment, and none were ever
contacted.

The engine is built as the **shared communication spine** for all
future engines (Engine 10 Media, Engine 11 Search, and beyond), per the
explicit architectural mandate that started this build. It reuses two
previously-dormant tables (`cc_domain_events`/`cc_integrations`)
correctly — `cc_integrations` is genuinely used (as the provider
registry); `cc_domain_events` was evaluated and NOT extended, because
Engine 9's own `notification_outbox` table is the correct home for
notification-specific state (see §3).

**Final verified state:**
- **187/187** test scenarios pass in one continuous consolidated
  regression run (Payment 59 + Booking 55 + Engine 9 73).
- **Zero new TypeScript errors** (17 pre-existing, unrelated errors
  unchanged).
- **Build passes.**
- **46/46 migrations applied**, including 0045 (schema) and 0046
  (34 templates).
- **No production deployment. No real provider credentials. No real
  message ever sent.**
- A genuine D1/Miniflare behavioral discovery (§7) was found by the
  test suite itself, root-caused, fixed, and re-verified — not
  hidden, not worked around by weakening a test.

---

## 2. Starting State

Before this work began, NaijaDeals had:
- No notification/outbox tables.
- `cc_domain_events` and `cc_integrations` (migration 0023) existed but
  were dormant — zero live callers.
- Zero event writers anywhere in the codebase that produced a
  user-facing notification for a business event.
- A single legacy `notifications` table (bare id/user_id/type/
  title/body/is_read) with no writers.
- A `newsletter_subscribers` table (email + created_at only, no
  consent/source/locale tracking).
- Engine 7 (Payment/Booking financial hardening) was complete,
  verified, and is the CAS discipline Engine 9 explicitly reuses and
  never weakens.

## 3. Existing Architecture Audit

`cc_domain_events` (migration 0023) is a generic append-only event log
with no delivery/retry/idempotency semantics of its own — it was
evaluated as a candidate to extend, and rejected as the outbox's home
table, because it lacks the delivery lifecycle Engine 9 needs
(`pending`/`processing`/`processed`/`failed`, retry metadata) and
retrofitting that onto a generic table used elsewhere would have
coupled Engine 9's schema evolution to every other consumer of
`cc_domain_events`. Engine 9 instead adds its own purpose-built
`notification_outbox` table (§6).

`cc_integrations` (migration 0023) IS reused as designed — it is a
well-shaped provider registry (`provider_key`, `category`, `status`,
`config_json`, `enabled`) with zero real callers before this work.
Engine 9 is its first real consumer (§9).

The legacy `notifications` table is reused as the in-app delivery
channel's real destination table (§10) — not replaced, not duplicated.

## 4. Engine 9 Target Architecture

```
business event (order/payment/booking/auth)
      |
      v
enqueueNotificationEvent()  -- durable, idempotent INSERT into
|                              notification_outbox (UNIQUE idempotency_key)
v
processOutboxEvent()  -- claims ONE pending event (CAS: pending->processing),
|                        fans out to notification_deliveries rows per
|                        enabled channel, dispatches each via the
|                        Integration Hub provider abstraction, marks the
|                        outbox event 'processed' (or rolls back to
|                        'pending' on an unexpected in-process exception)
v
notification_deliveries rows (one per channel), each independently
tracking queued -> attempted -> accepted/delivered/failed/unavailable
      |
      v (on a later request, if a channel's delivery is transient-failed)
retryFailedDeliveries()  -- bounded, backed-off catch-up pass
```

Five real source files call into this pipeline as event writers
(§16): `src/routes/api-auth.ts`, `src/lib/orders.ts`,
`src/lib/refunds.ts`, `src/lib/order-lifecycle.ts`,
`src/lib/booking-lifecycle.ts`.

## 5. Communication Event Model

An event is uniquely identified by a **business-semantic idempotency
key**, never a bare autoincrement id or random UUID — e.g.
`payment_confirmed:482`, `order_item_shipped:9931`,
`account_registered:17`. This means the SAME real-world business
occurrence can be enqueued any number of times (retried checkout call,
concurrent webhook deliveries, a customer refreshing a page) and will
only ever create one outbox row (§7).

Nine categories exist: `transactional`, `security`, `order`,
`booking`, `delivery`, `payment`, `marketing`, `promotional`,
`system`. Two (`transactional`, `security`) are **mandatory** — see
§12.

## 6. Outbox Architecture

`notification_outbox` (migration 0045): one row per business event.
Columns: `idempotency_key` (`UNIQUE`), `event_type`,
`recipient_user_id`, `category`, `payload_json`, `reference_type`,
`reference_id`, `status` (`pending`/`processing`/`processed`/
`failed`), `attempts`, `last_error`, `created_at`, `processed_at`.

Why a request-triggered "process on request" model instead of a
background queue: this repository's `wrangler.jsonc` has no
`triggers`/cron configured, and Cloudflare's hosted-deploy path
explicitly rejects a `triggers` field; Workers Queues are a paid-plan
feature not provisioned here. The lowest-cost architecture compatible
with what is actually available: outbox rows accumulate durably in
D1; a bounded "process next N pending events" pass runs (a) inline
immediately after enqueue (`enqueueAndProcessNow`, for the in-app
channel's instant delivery), and (b) via an admin-triggered catch-up
endpoint (`POST /api/admin/notifications/process-outbox`) for anything
that didn't complete inline. This is a durable-outbox-with-catch-up
pattern, not a fabricated "queue."

## 7. Idempotency Model — including the mandatory D1/Miniflare finding

**What was initially assumed:** `enqueueNotificationEvent()`'s
`INSERT ... ON CONFLICT(idempotency_key) DO NOTHING` used
`result.meta.rows_written` to detect whether the insert actually
created a new row, copying Engine 7's existing CAS idiom
(`wallet.ts`/`orders.ts`/`refunds.ts`/`order-settlement.ts`, all of
which use a **conditional UPDATE** — `UPDATE ... WHERE status =
'pending'` — where `rows_written` genuinely is 0 for a no-op).

**How it was reproduced:** the newly-written idempotency test suite
(`tests/notification-engine/02.idempotency-concurrency.test.mjs`) has
ten scenarios exercising sequential duplicates, 5x-repeated duplicates,
and 2/4/8-way concurrent duplicate `enqueueNotificationEvent()` calls
for the same idempotency key, each asserting exactly one row is ever
created. Under the ORIGINAL `rows_written`-based check, 4 of these 10
scenarios failed — the second (duplicate) call's `created` flag came
back `true` when it should have been `false`. Direct minimal repro
scripts against the real local D1 binding (three independent runs)
confirmed the root cause precisely: for THIS project's D1/Miniflare
version, `INSERT ... ON CONFLICT DO NOTHING` reports `rows_written: 1`
even on a genuine no-op conflicting insert (apparently counting
secondary-index bookkeeping), while `meta.changes` correctly reported
`0` for the no-op and `1` for a genuine insert in every case tested.

**Why the assumption was wrong:** the `rows_written`-is-zero-for-a-
no-op idiom is correct and proven for a **conditional UPDATE**
(Engine 7's pattern: an UPDATE whose WHERE clause fails to match any
row genuinely writes zero rows). It does NOT hold for an **INSERT with
ON CONFLICT DO NOTHING** on this D1/Miniflare version — the two SQL
shapes report `rows_written` differently even though both are
legitimate CAS patterns.

**What was changed:** two sites in `src/lib/notifications.ts` were
corrected from `(result.meta.rows_written ?? 0) > 0` to
`(result.meta.changes ?? 0) > 0`:
1. `enqueueNotificationEvent()`'s outbox insert.
2. `dispatchChannel()`'s per-channel `notification_deliveries` insert
   (same `INSERT ... ON CONFLICT(outbox_id, channel) DO NOTHING`
   shape, same risk).

The **conditional-UPDATE** sites (`claimOutboxEvent()`,
`retryFailedDeliveries()`'s CAS claim `UPDATE ... WHERE status =
'failed'`) were independently verified via a separate repro to
correctly report `rows_written: 0` for a no-op and were **left
unchanged** — mixing up these two idioms in either direction would
have been a real defect.

**Which tests caught it:** `02.idempotency-concurrency.test.mjs`,
specifically every assertion of the form
`assert.equal(second.created, false, ...)`.

**Final test result after the fix:** 10/10 pass, re-confirmed twice in
this session (once standalone, once inside the final 187/187
consolidated run).

This is an important engineering finding: **the correct field to check
for a D1 CAS guard depends on the SQL shape** (`INSERT ... ON CONFLICT
DO NOTHING` → `meta.changes`; conditional `UPDATE ... WHERE <guard>` →
`meta.rows_written`), not a single universal rule. Any future D1 CAS
code in this repository should re-verify which shape it is using
before choosing which field to trust.

## 8. Notification Delivery Model

`notification_deliveries` (migration 0045): one row per
`(outbox_id, channel)` pair, `UNIQUE(outbox_id, channel)`. Truthful
status vocabulary (verified in `07.providers-outbox.test.mjs`):
`queued → attempted → accepted → delivered | failed | unavailable |
not_configured | skipped`. `failure_class` is `transient` or
`permanent`, decided by the provider abstraction (§9), never guessed
by the caller. `delivered` is reserved for an ACTUAL adapter
"delivery" step having actually run — never assumed from a `queued`
state.

A single channel's dispatch failure never blocks the OTHER channels
for the same event, and never blocks the outbox event from reaching
`processed` — verified directly in
`07.providers-outbox.test.mjs`'s transient/permanent failure tests.

## 9. Provider Abstraction

`src/lib/notification-providers.ts` wraps `cc_integrations` (category
`email`/`sms`/`push`). This environment has **zero real provider
credentials** anywhere (confirmed by the original Phase 1 forensic
audit: no resend/sendgrid/twilio/africastalking/firebase in
`package.json`, no matching secret in `.dev.vars`, nothing in
`wrangler.jsonc` bindings). Every dispatch therefore runs through a
**deterministic test adapter** (`runTestAdapter`) that:
- never calls a network endpoint,
- truthfully self-labels its raw response as `{adapter: 'test', ...}`,
- always returns `delivered` for a normal input,
- returns a `failed`/`transient` or `failed`/`permanent` outcome ONLY
  when the payload body contains one of two test-only sentinel
  strings (`__SIMULATE_TRANSIENT_FAILURE__` /
  `__SIMULATE_PERMANENT_FAILURE__`), used exclusively by the test
  suite to exercise the failure/retry paths without a real flaky
  provider.

If `cc_integrations` reports a channel's provider as `enabled=0`, the
abstraction returns `not_configured`; if `enabled=1` but
`status` is anything other than `configured`/`healthy`, it returns
`unavailable` — both verified directly (`07.providers-outbox.test.mjs`,
tests 6–7). **No code path can ever fabricate a `delivered` status
without the test adapter's own step having genuinely run.**

To add a real provider later: implement a
`dispatchViaProvider`-shaped call for the new `provider_key`, register
it, and flip that key's `cc_integrations.status` to
`configured`/`healthy` with real secrets (via `wrangler secret`, never
committed). Zero changes required in `notifications.ts`.

## 10. In-App Notification Architecture

The `in_app` channel is the ONE channel handled synchronously and
directly inside `performDispatchAndRecord()` — it writes a real row
into the legacy `notifications` table (`user_id`, `type`, `title`,
`body`, `action_url`, `reference_type`, `reference_id`) and
immediately marks its `notification_deliveries` row `delivered`. This
is the only channel that can honestly be called "delivered" the
moment the function returns.

## 11. Preference System

`notification_preferences` (migration 0045): one row per
`(user_id, category, channel)`. Absence of a row means "use the
category's application-layer default"
(`DEFAULT_CHANNELS_BY_CATEGORY` in `notifications.ts`). Resolution
happens in `resolveChannelsForRecipient()` — the ONLY place fan-out
decisions are made, so no code path can bypass it. Full CRUD verified
in `03.preferences-api.test.mjs` (8 scenarios): matrix read,
enable/disable round-trip, invalid-value rejection, cross-user
isolation.

## 12. Mandatory Notification Categories

`transactional` and `security` are in `MANDATORY_CATEGORIES` — always
resolved to their default channel set regardless of any stored
preference, and any attempt to disable them via
`PUT /api/notifications/preferences` is rejected with `400` at the
write layer (`setNotificationPreference`'s explicit `PreferenceError`
check) — enforced independently at BOTH the read layer
(`resolveChannelsForRecipient`) and the write layer, so a bug in
either cannot silently bypass the other. Verified in
`03.preferences-api.test.mjs` tests 4–5.

## 13. Consent Decision — DEFERRED WITH EXPLICIT BOUNDARY

`communication_consents` (migration 0045) exists in the schema
(`purpose` CHECK'd to `marketing`/`promotional`, `consent_given`,
`source`, `legal_basis`, etc.) but **is schema-only by deliberate,
documented decision.** Grep across all five real event writers
(`src/lib/order-lifecycle.ts`, `src/lib/booking-lifecycle.ts`,
`src/lib/orders.ts`, `src/lib/refunds.ts`, `src/routes/api-auth.ts`)
confirms **zero** of them ever produce a `marketing` or `promotional`
category event. `05.consent-boundary.test.mjs` (5 scenarios)
functionally proves this boundary: the table has zero rows written by
any code path, registering a user never touches it, and the
`marketing`/`promotional` categories remain reachable through the
ordinary **opt-out** preference mechanism (§11) — not gated by any
consent record.

**Scope statement (verbatim, as required):**
- **TRANSACTIONAL/SERVICE NOTIFICATION SCOPE:** implemented, according
  to the notification preference rules in §11–12.
- **MARKETING COMMUNICATION:** outside the currently implemented
  Engine 9 delivery scope. The `communication_consents` table remains
  prepared (correct schema, indexed, CHECK-constrained) for a future
  marketing/promotional delivery feature, but no such feature is
  implemented, and none is claimed to be.

## 14. Retry Architecture

**Precise description of what actually exists (not "an autonomous
background worker" — no continuously-running scheduler exists in
this Cloudflare Pages/Workers deployment):**

- `MAX_DELIVERY_ATTEMPTS = 5`, `RETRY_BACKOFF_MINUTES = [1, 5, 15, 60,
  240]` — a fixed, bounded exponential-ish backoff table in
  `notifications.ts`.
- `nextRetryDelayMinutes(attemptCountAfterThisFailure)` returns `null`
  once attempts reach the max — a delivery in that state gets no
  `next_retry_at` and is genuinely terminal.
- Only `transient`-classified failures are ever scheduled for retry;
  `permanent` failures never get a `next_retry_at`.
- `retryFailedDeliveries(db, limit)` is the retry pass itself: it
  selects due (`next_retry_at <= now`), transient, not-yet-exhausted
  rows, **CAS-claims** each one (`UPDATE ... SET status='queued'
  WHERE id=? AND status='failed'` — the proven conditional-UPDATE
  idiom, correctly using `rows_written`), then reuses the SAME
  delivery row via `performDispatchAndRecord` (never inserts a
  duplicate — enforced independently by `UNIQUE(outbox_id, channel)`).
- **How retries are actually triggered:** exclusively by an
  **admin-invoked HTTP request** — `POST
  /api/admin/notifications/retry-failed` (gated by
  `requirePlatformRole('admin')`). There is no cron, no Queue
  binding, no timer. This is the same "process on request" pattern
  as the outbox's own catch-up pass (§6), for the same platform
  constraint (no `triggers` support under hosted deploy).
- Verified in `07.providers-outbox.test.mjs` (9 of its 14 scenarios):
  due-and-succeeding retry reuses the same row, not-yet-due rows are
  skipped, 2-way concurrent retry passes over the same row never
  double-dispatch (CAS-proven), and an attempt-exhausted row is never
  picked up again.

## 15. Template Architecture

`notification_templates` (migration 0045): `(event_type, channel,
locale, version)` with `UNIQUE` on all four, `is_active` flag.
Migration 0046 seeds **34 real templates** — the 17 real event types
the five event writers actually produce (`account_registered`,
`payment_confirmed`, `refund_completed`, 6 `order_item_*` variants, 8
`booking_*` variants) × 2 channels (`in_app`, `email`). Verified count
directly against the local D1 file in this session: `total=34` (for
these 17 real event types), `event_types=17` — see §31.

`interpolate()` in `notification-templates.ts` does single-pass
`{{key}}` token replacement:
- unknown/undeclared keys render as empty string, never `undefined`,
  never a thrown error (`06.template-safety.test.mjs` test 2–3);
- every substituted VALUE is HTML-escaped (`&<>"'`) before insertion —
  closes the stored-XSS-via-notification vector (test 4–5);
- the TEMPLATE STRING itself is never evaluated as code — no `eval`,
  no `Function()`, plain-text pass-through for anything not a
  `{{token}}` (test 6–7);
- `renderTemplate()` falls back to an honest minimal rendering
  (`event_type` as title, empty body, no action URL) when no active
  template row exists for `(event_type, channel, locale)` — never
  throws, never blocks delivery of an otherwise-legitimate event
  (test 8).

`createTemplateVersion()` always inserts a NEW version row, never
mutates an existing one in place; `renderTemplate()` always selects
the highest active version (test 10).

**Locale:** only `en` is seeded (Phase 8's explicit "data model
without implementing every country now" decision). The schema
supports multiple locales structurally (`locale` column,
`UNIQUE(event_type, channel, locale, version)`), but no non-English
locale content is implemented, and none is claimed.

## 16. Event Writers

Five real call sites, each `enqueueAndProcessNow`-ing strictly AFTER
its own business commit, each wrapped in a non-rethrowing
`try { ... } catch { console.error(...) }`, confirmed by direct source
inspection (`08.regression-proof.test.mjs` test 5, which searches for
the actual call site `enqueueAndProcessNow(` — not a preceding
explanatory comment — and asserts a `try {` precedes it within 400
characters and a `catch (` follows within 500):

| File | Event(s) |
|---|---|
| `src/routes/api-auth.ts` | `account_registered` |
| `src/lib/orders.ts` | `payment_confirmed` |
| `src/lib/refunds.ts` | `refund_completed` |
| `src/lib/order-lifecycle.ts` | `order_item_{shipped,delivered,completed,cancelled,refunded,partially_refunded}` (customer-notifiable statuses only) |
| `src/lib/booking-lifecycle.ts` | `booking_{confirmed,checked_in,completed,cancelled,declined,expired,no_show,disputed}` |

## 17. Integration with Orders

`src/lib/orders.ts`'s `runOrderPaymentSideEffects()` enqueues
`payment_confirmed:${orderId}` strictly after the payment CAS claim has
already won and stock/affiliate/logistics side effects have already
run. Idempotency key is order-scoped (not provider-reference-scoped)
because "payment confirmed" is a one-time-per-order business fact
regardless of which payment path won the race.

## 18. Integration with Bookings

`src/lib/booking-lifecycle.ts` enqueues a
`booking_${targetStatus}:${bookingId}` event strictly after
`recomputeOrderAggregateStatus`-equivalent booking-state commit, for
customer-facing terminal/near-terminal statuses only.

## 19. Integration with Payments

Payment confirmation (§17) is the payment-side event writer;
no other payment code path independently writes notifications — the
webhook-hardening tests (`payment-engine/02`) and the CAS tests
(`payment-engine/03`) were re-verified to still pass unchanged after
Engine 9's presence (§29), proving the addition is genuinely
non-invasive.

## 20. Integration with Refunds

`src/lib/refunds.ts`'s `createAndExecuteRefund()` enqueues
`refund_completed:${refundId}` strictly after the wallet credit AND
the `refunds` row's `status='completed'` commit — never before. The
refund-concurrency suite (`payment-engine/04`, 11/11) was re-verified
unchanged.

## 21. Seller/Vendor Security

`resolveSellerVendor()` (inline in `src/routes/api-seller.ts`) derives
"which vendor am I" EXCLUSIVELY from the authenticated session's
`user_id` via `vendors.user_id`, never from any client-supplied
`vendor_id`. The test harness's `registerSeller()` helper seeds a
fresh, genuinely-owned, onboarded vendor row per test (mirroring what
a real onboarding wizard would leave behind) — it does not change how
the runtime resolves identity. Verified functionally in
`00.smoke.test.mjs` test 3: a seller-driven order-item status
transition produces a notification addressed to the CUSTOMER, never
the seller, and the seller's own action never generates a
notification to themselves.

## 22. API Security

A dedicated forensic suite, `09.api-security.test.mjs` (16 scenarios),
distinct from incidental coverage elsewhere:
- unauthenticated access to `/api/notifications`,
  `/api/notifications/unread-count`, and every admin notifications
  route → `401`;
- a user can only ever list/see their OWN notifications — cross-user
  list leakage proven absent;
- marking ANOTHER user's notification read → `404`, and — verified
  via a direct D1 read, not just the HTTP code — the target row is
  NOT mutated;
- a positive control proves the 404 above is ownership-scoped, not a
  general bug (the SAME user CAN mark their own notification read);
- garbage/non-numeric notification id → `400`, never `500`;
- an ordinary authenticated (non-admin) user → `403` from
  `overview`/`process-outbox`/`retry-failed`;
- a positive control (promote-then-retry) proves the 403s are
  role-based, not broken auth;
- the observability overview NEVER includes `config_json`, credential
  material, or per-recipient content — verified by asserting the raw
  JSON string never contains the literal substring `config_json` and
  by asserting every provider row has EXACTLY the four expected keys
  (`category`, `enabled`, `provider_key`, `status`), no more;
- a REAL XSS-safety proof (§26) through the actual registration
  event-writer path, not a synthetic unit call;
- an unknown/undeclared template variable renders as empty string in
  a real dispatch, never leaking `undefined` or `{{token}}`;
- the admin `retry-failed`/`process-outbox` endpoints enforce their
  server-side `Math.min(..., 100)` cap even when a caller requests an
  excessive `?limit=999999` — a DoS guard, verified structurally (the
  response's `attempted` field can never exceed 100).

## 23. Control Center

`GET /api/admin/notifications/overview` (admin-gated,
`requirePlatformRole('admin')`, same middleware as every other route
in `api-admin.ts`) surfaces real aggregate counts only — outbox status
counts, delivery counts by channel/status, retry-pending/permanently-
failed counts, provider status enums, template total/active counts.
No content, no secrets (§22, §24).

`POST /api/admin/notifications/process-outbox` and `POST
/api/admin/notifications/retry-failed` are the two admin-triggered
catch-up passes (§6, §14) — never automatic, never hidden, both
bounded and capped.

## 24. Observability

See §22/§23 — `getNotificationEngineOverview()` in
`notification-observability.ts` deliberately does NOT select
`cc_integrations.config_json`, does NOT join to any per-user
notification content, and returns only aggregate `COUNT(*) ...
GROUP BY` results and status enums.

## 25. Africa/Multi-country Architecture

Not extended in this build. The template system's `locale` column and
`UNIQUE(event_type, channel, locale, version)` constraint are
structurally ready for multi-locale content (§15), but only `en` is
seeded. No SMS/push provider with Africa-specific routing (e.g.
Africa's Talking) is wired — the SMS/push channels use the same
generic deterministic test adapter as email (§9). This is an honest
gap, not a claimed feature.

## 26. Security Findings

The one genuine security-relevant finding surfaced by this session's
testing was in the **test code itself**, not the application: an
initial XSS-safety assertion in `09.api-security.test.mjs` incorrectly
asserted that the literal substring `onerror=` must never survive
HTML-escaping. Direct verification of `escapeHtml()`
(`notification-templates.ts`) showed it correctly escapes the five
tag-boundary characters (`& < > " '`) — sufficient to make it
structurally impossible for a malicious payload to open or close an
HTML tag or attribute inside a rendered notification body, which is
the actual security property. `escapeHtml()` does not need to (and
does not) touch the literal character `=`, since a lone `=` cannot by
itself form or close a tag. The test assertion was corrected to check
for the absence of any unescaped opening HTML tag (`/<[a-z]/i`)
instead of a specific substring, and re-verified: a real registration
using `<script>alert(1)</script><img src=x onerror=alert(2)>` as the
`name` field produces a stored notification body containing
`&lt;script&gt;...&lt;img...&gt;` — fully inert as HTML, with the
malicious input visibly preserved (proving it was rendered, not
silently dropped) but never executable.

No other security defect (application or test) was found. Cross-user
notification/preference isolation, admin-role enforcement, and
observability endpoint non-leakage were all found correct on first
principled testing (§22).

## 27. Concurrency Findings

All concurrency invariants hold, verified by direct N-way concurrent
calls against the real local D1 binding:
- 2/4/8-way concurrent `enqueueNotificationEvent()` for the same
  idempotency key → exactly one winner (post-fix; see §7 for the
  pre-fix failure).
- 2/4-way concurrent `processOutboxEvent()` claim attempts on the same
  outbox id → exactly one wins the `pending→processing` CAS.
- Concurrent dispatch attempts can never create a duplicate
  `notification_deliveries` row for the same `(outbox_id, channel)`
  pair (`UNIQUE` constraint as the second, independent line of
  defense beyond the outbox claim).
- 2-way concurrent `retryFailedDeliveries()` passes over the same due
  row → exactly one performs the retry (CAS-claimed).

No new financial-domain concurrency work was needed — Engine 7's
existing wallet/order/refund/settlement CAS discipline was re-verified
unchanged (§29) and Engine 9 never touches those code paths except to
call into them strictly after they have already committed (§16–20).

## 28. Test Architecture

Two invocation modes, never mixed in one file:
- **HTTP mode** (`tests/notification-engine/helpers/client.mjs`):
  drives the real running `wrangler pages dev` server via `fetch()`.
  Requires the PM2 dev server RUNNING. Invoked as `node
  --experimental-strip-types --test <file>`.
- **direct-lib mode**
  (`tests/notification-engine/helpers/direct-db.mjs`): opens its own
  `getPlatformProxy()` D1 connection in-process to call library
  functions (`enqueueNotificationEvent`, `processOutboxEvent`,
  `retryFailedDeliveries`, `renderTemplate`, `dispatchViaProvider`)
  directly — there is no 1:1 HTTP endpoint for these. Requires the PM2
  dev server STOPPED (running both simultaneously against the same
  local SQLite file causes `SQLITE_BUSY` lock contention — diagnosed
  and confirmed earlier in this engagement). Invoked as `node
  --experimental-strip-types --experimental-loader
  ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test
  <file>`.

**A real test-authoring defect found and fixed in THIS closure
session:** `07.providers-outbox.test.mjs` originally used static
`event_type` string literals (e.g. `'outbox_transient_event'`) when
inserting synthetic rows into `notification_templates` for six of its
scenarios. Since the local D1 SQLite file persists across separate
test invocations (it is not reset per run), running this file a
SECOND time collided with the FIRST run's leftover rows against
`notification_templates`'
`UNIQUE(event_type, channel, locale, version)` constraint, producing 6
failures on the second run of an otherwise-correct file. Diagnosed by
direct D1 inspection (found the exact leftover rows from the earlier
run), confirmed as a test-fixture defect (not an application defect —
`enqueueNotificationEvent`, `retryFailedDeliveries`, and the
`notification_templates` table all behaved correctly), and fixed by
suffixing every synthetic `event_type` with the test's own freshly-
created `userId` (the same uniqueness pattern every other test in this
suite already uses for its `idempotencyKey`). Re-verified by running
the fixed file twice in direct succession — 14/14 pass both times —
before re-running the full consolidated regression.

## 29. Final Test Results

**One continuous consolidated regression run**, executed via
`scripts/run-consolidated-regression.sh`, driving the exact sequence
and invocation mechanism specified for this closure, with a
continuous append-only log (`/tmp/consolidated_regression2.log`),
parsed programmatically (not summarized from memory):

| Suite | File | Pass | Fail |
|---|---|---|---|
| Payment | 01.wallet-concurrency | 12 | 0 |
| Payment | 02.webhook-hardening | 9 | 0 |
| Payment | 03.order-payment-cas | 11 | 0 |
| Payment | 04.refund-concurrency | 11 | 0 |
| Payment | 05.variable-weight-settlement-cas | 16 | 0 |
| Booking | 01.booking-creation | 5 | 0 |
| Booking | 02.authorization-tenant-isolation | 7 | 0 |
| Booking | 03.state-machine | 6 | 0 |
| Booking | 04.availability-collision | 5 | 0 |
| Booking | 05.concurrency | 4 | 0 |
| Booking | 06.cancellation-refund | 10 | 0 |
| Booking | 07.provider-ownership-isolation | 7 | 0 |
| Booking | 08.idempotency | 5 | 0 |
| Booking | 09.security-regression | 6 | 0 |
| Engine 9 | 00.smoke | 4 | 0 |
| Engine 9 | 02.idempotency-concurrency | 10 | 0 |
| Engine 9 | 03.preferences-api | 8 | 0 |
| Engine 9 | 05.consent-boundary | 5 | 0 |
| Engine 9 | 06.template-safety | 10 | 0 |
| Engine 9 | 07.providers-outbox | 14 | 0 |
| Engine 9 | 08.regression-proof | 6 | 0 |
| Engine 9 | 09.api-security | 16 | 0 |
| **TOTAL** | **22 files** | **187** | **0** |

**187/187, 0 failures, every file exit code 0.** This exact total
(Payment 59 + Booking 55 + Engine 9 73 = 187) was independently
computed by a parsing script reading the actual TAP output of the
actual run, not asserted from the arithmetic sum of historical
per-file numbers.

Concurrency-specific results: all 2/4/8-way race scenarios across
Payment CAS, Booking availability/idempotency, and Engine 9
outbox/retry claims passed with exactly one winner each time (§27).

API-security-specific: 16/16 in `09.api-security.test.mjs` (§22).

XSS safety: verified via a real registration event-writer path
producing a fully-escaped stored notification body (§26).

Retry tests: 9 of 14 in `07.providers-outbox.test.mjs` directly
exercise the retry scheduler (§14).

Provider tests: the remaining 5 of `07.providers-outbox.test.mjs`
exercise the deterministic test adapter and its `not_configured`/
`unavailable` honest-failure paths (§9).

Preference tests: 8/8 in `03.preferences-api.test.mjs` (§11–12).

Consent-boundary tests: 5/5 in `05.consent-boundary.test.mjs` (§13).

## 30. Build/TypeScript Results

- `npx tsc --noEmit`: **17 errors**, all in files unrelated to Engine 9
  (`src/pages/auth.tsx`, `src/pages/home.tsx`, `src/pages/orders.tsx`,
  `src/pages/product.tsx`, `src/renderer.tsx`, `src/routes/api-cart.ts`,
  `src/routes/api-catalog.ts`) — matches the known pre-existing
  baseline exactly. **Zero new errors.**
- `npm run build`: **PASS** — `dist/_worker.js 567.56 kB (gzip:
  129.31 kB)`, built in 322ms.

## 31. Migration Results

- 46 migration files present in `migrations/`.
- `npx wrangler d1 migrations list naijadeals-production --local` →
  `✅ No migrations to apply!` (all 46 already applied).
- Direct query: `SELECT COUNT(*) FROM d1_migrations` → **46**.
- `notification_templates`: total rows for the 17 real seeded event
  types = **34** (exactly 17 × 2 channels), confirmed via a direct
  `WHERE event_type IN (...)` query listing all 17 real event types
  explicitly. (The table also accumulates additional rows from
  repeated direct-lib test runs using synthetic per-test event types —
  expected test-fixture artifacts in the persistent local dev
  database, not a defect; see §28.)
- No production migration/database was touched.

## 32. Known Limitations

- No real email/SMS/push provider is configured or contacted anywhere
  — every dispatch uses the deterministic test adapter (§9). This is
  intentional per the "no fake providers" mandate, not an oversight.
- Marketing/promotional consent enforcement is schema-only, not
  functionally implemented — see the explicit DEFERRED boundary (§13).
- Retry is a bounded, admin-request-triggered catch-up pass, not an
  autonomous background worker — this is the correct architecture for
  this platform's constraints (no cron/Queue binding available), not a
  compromise (§14).
- Only English (`en`) locale content exists; the schema is
  multi-locale-ready but unpopulated for any other locale (§15, §25).
- SMS/push channels use the same generic test adapter as email; no
  Africa-specific SMS routing is wired (§25).
- Browser/UI verification for any Engine 9-facing UI: **NOT PERFORMED
  / BLOCKED** — no Playwright or other real browser execution occurred
  in this engagement for Engine 9. All verification in this document
  is HTTP-level (via the `ApiClient` test harness) or direct-library-
  level, never a claimed browser-rendered PASS.

## 33. Production Deployment Status

**NO PRODUCTION DEPLOYMENT PERFORMED.** No production database was
written to. No real email/SMS/push provider was contacted — every
dispatch in every test and in every real code path in this local
environment used the deterministic test adapter (§9). All 187 test
scenarios ran against the local `wrangler pages dev` / local D1 SQLite
environment only.

## 34. Final Checkpoint

To be filled in immediately before the final commit/push in this same
session, once this document itself is staged:

- **Local HEAD SHA (before this commit):** `99db15c`
- **This document's commit SHA:** recorded below after `git commit`
- **origin/main SHA after fetch:** recorded below after `git fetch`
- **GitHub API main SHA:** recorded below after querying the API
- **Three-way match:** recorded below

(See the commit message and the final report in this session for the
actual recorded SHAs — this section intentionally is completed as the
very last step, after `git push`, per the mandated Phase 9 sequencing.)
