# NaijaDeals — Engine 7: Payment & Finance Audit
## Phase 1 — READ-ONLY Audit Report

**Status:** AUDIT ONLY. No payment, wallet, ledger, refund, dispute, payout,
provider-integration, or schema code was modified while producing this
report. The only artifact created by this unit is this document.

**Audit date:** 2026-09-12
**Repository SHA at time of audit (start = end, no code changed):** `9a1300478d4964f75da97f96e699fe2649efb74d`
**Branch:** `main`
**Working tree at start:** CLEAN

**Method:** Direct code/schema/route inspection (`Read`, `Grep`, `Bash`) of
every file cited below, plus one live read-only `curl` against
`https://naijadeals.com/api/version` to check production deployment state.
No claim in this document is inferred from a name, comment, or prior report
alone — every row in the matrix is backed by a specific file/line cited in
its Evidence column. Where evidence could not be found after an exhaustive
search, the row is marked **NO** / **CONFIRMED ABSENT**, not left blank.

Legend: ✅ Yes (evidence found) · ❌ No (confirmed absent) · ⚠️ Partial/Risk ·
`N/A` not applicable to that component.

---

## 1. Executive Summary

NaijaDeals has a **real, working, single-currency (NGN) wallet-based payment
system** wired into both Bookings and Marketplace Orders, backed by one
authoritative ledger (`wallet_ledger`) and one payment provider (Paystack).
Refunds and disputes are genuinely integrated across admin/customer/seller
route perspectives and correctly reuse that one ledger — a real
"integrate, don't duplicate" success. The recently-hardened
`payForBooking()` CAS pattern (Invariant 9, commit `9a13004`) is the single
best-protected financial code path in the repository today.

Everything beyond that — **escrow (as an actual fund-transfer mechanism),
seller payouts, provider payouts, a second payment provider, multi-currency
support, and a Control Center financial dashboard — does not exist as
application code.** Several of these have full database schema already
reconstructed from production (seller ledger, payout accounts, encrypted
bank-detail storage, Integration Hub provider registry) with **zero**
implementing TypeScript behind them. This is exactly the
EXISTS-but-NOT-IMPLEMENTED pattern this audit was commissioned to find, and
it is the largest single category of finding below.

Two **live, unfixed, genuine concurrency risks** were found in the current
payment code, one of them (Paystack webhook) in the exact same bug class as
the real 8× overcharge just fixed in Booking Invariant 9. Per this unit's
explicit instructions, **neither was fixed** — both are documented below as
Engine 7 blockers requiring remediation before further payment features are
built on top of them.

Production (`naijadeals.com`) is running `git_sha 99b1664df...`, which does
**not exist anywhere in this repository's git history** (confirmed again
this session via `git cat-file -e`) — carried forward from prior audits,
re-verified here specifically for its payment implications: **no claim in
this document about "local implementation" should be read as a claim about
what code the live production Worker is actually running.**

---

## 2. Methodology

1. Repository-wide `grep` sweep for every keyword the audit spec listed:
   `payment`, `paystack`, `flutterwave`, `stripe`, `wallet`, `ledger`,
   `transaction`, `refund`, `dispute`, `escrow`, `payout`, `commission`,
   `fee`, `settlement`, `withdrawal`, `charge`, `webhook`, `idempotency`,
   `currency`.
2. Full reads of every file a hit above led to: `src/lib/wallet.ts`,
   `src/lib/paystack.ts`, `src/lib/money.ts`, `src/lib/orders.ts`,
   `src/lib/refunds.ts`, `src/lib/order-settlement.ts`,
   `src/lib/booking-payments.ts`, `src/lib/affiliate.ts` (partial, 587
   lines), `src/lib/service-orders.ts` (partial), `src/lib/country.ts`,
   `src/routes/api-wallet.ts`, `src/routes/api-webhooks.ts`,
   `src/routes/api-orders.ts`, `src/routes/api-admin.ts`,
   `src/routes/api-seller.ts`, `src/lib/rbac.ts`.
3. Migration-by-migration schema inspection: `0001` (payment_transactions,
   wallet_ledger, wallet_accounts), `0009` (seller_payout_accounts,
   seller_finance_accounts), `0014` (seller_ledger), `0017`/`0018`
   (affiliate finance), `0023` (Integration Hub), `0040` (refunds,
   disputes, order_additional_charges), `0041` (booking payment fields).
4. Cross-check of every schema table found against `src/lib/*.ts` for a
   corresponding reader/writer — a table with zero application-code
   references is explicitly flagged as such, never assumed wired-up.
5. Route-layer audit: for every financial `lib` function, grep'd its
   callers in `src/routes/*.ts` to determine INTEGRATED vs. merely EXISTS,
   and read the surrounding auth middleware (`requireAuth`,
   `requirePlatformRole`, `requireOrganizationMember`/`requirePermission`,
   `requireSellerVendor`) to determine the actual authorization boundary.
6. Test inventory: `find tests/`, `ls scripts/`, `grep` inside each script
   for financial keywords — to distinguish a real test suite from a
   hand-rolled verification script.
7. One live read-only `curl https://naijadeals.com/api/version` (GET only,
   no side effects) to check production deployment state, cross-referenced
   against `git cat-file -e <production sha>` to confirm (again) that
   production's running code is not present in this repository's history.
8. No code, schema, or test file was created or modified during any of the
   above steps.

---

## 3. Component Matrix

| # | Component | Exists | Implemented | Integrated | Tested | Verified | GitHub-Persisted | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | Payment Foundation | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | `migrations/0001_initial_schema.sql:183-213` (`wallet_ledger`, `wallet_accounts`, `payment_transactions`); consumed by `src/lib/wallet.ts`, `src/routes/api-wallet.ts`, `src/routes/api-orders.ts`. Tested only via `tests/booking-engine/*` (booking side); no dedicated payment-foundation unit tests exist. |
| 2 | Paystack | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ | `src/lib/paystack.ts` (init/verify/webhook-signature, HMAC-SHA512 via Web Crypto); called from `src/routes/api-wallet.ts` (topup) and `src/routes/api-orders.ts` (checkout) and `src/routes/api-webhooks.ts`. **No evidence of a real Paystack transaction ever being verified** — no test, log, or script exercises the live Paystack API; `PAYSTACK_SECRET_KEY` presence/validity in any environment was not (and could not be, read-only) confirmed. |
| 3 | Flutterwave / Other Providers | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | `grep -rn "flutterwave\|stripe" src/ migrations/ package.json` → zero matches, exit code 1. No second provider exists in any form. |
| 4 | Wallet | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | `src/lib/wallet.ts` (`getWalletBalance`, `creditWallet`, `debitWallet`, `getWalletHistory`) — **customer wallet only** by every call site found (topup, order payment, booking payment, refund credit); no seller/provider/platform wallet semantics exist anywhere. See §5 Finding G-1 for a real concurrency gap in the primitive itself. |
| 5 | Ledger | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ✅ | `wallet_ledger` (migration 0001) is an **append-only balance-accounting ledger with a cached-balance read-optimization row** (`wallet_accounts.cached_balance_kobo`), explicitly documented as such in `wallet.ts`'s own header comment. **This is NOT double-entry accounting** — there is no offsetting "platform" or "counterparty" account row for any transaction; every entry is single-sided (one user_id, one entry_type, one amount) with no linked contra-entry. Every debit/credit carries `reference_type`/`reference_id` back to its source (booking, order, refund, topup), which is real traceability, but it is balance accounting, not double-entry. |
| 6 | Booking Payments | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `src/lib/booking-payments.ts::payForBooking()` — atomic CAS claim (`UPDATE bookings SET payment_status='escrow_held' ... WHERE payment_status='unpaid'`, checking `rows_written`) before `debitWallet()`, with rollback-on-debit-failure. **Authoritative as of commit `9a13004`** — this audit did not modify it. Verified via `tests/booking-engine/08.idempotency.test.mjs` + `09.security-regression.test.mjs`, 55/55 full-suite pass, run twice. This is the single most rigorously verified financial code path in the repository. |
| 7 | Order Payments | ✅ | ⚠️ | ✅ | ❌ | ❌ | ✅ | `src/lib/orders.ts::confirmOrderPayment()` / `payOrderFromWallet()`, called from `src/routes/api-orders.ts` (checkout) and `src/routes/api-webhooks.ts` (Paystack). Idempotency guard exists (`if (order.payment_status !== 'unpaid') return`) but is **read-then-branch with no CAS/atomic claim** — same TOCTOU class as the booking bug that was fixed, unfixed here (see §5 Finding G-2). Zero automated tests exist for the order-payment path. |
| 8 | Refunds | ✅ | ✅ | ✅ | ❌ | ⚠️ | ✅ | `src/lib/refunds.ts::createAndExecuteRefund()` — over-refund guard (`remaining = capturedKobo - alreadyRefunded`), routes to the single `creditWallet`. Called from `src/routes/api-admin.ts:192` (admin, `requirePlatformRole('admin')`-gated) — **no seller-initiated refund route exists**, only seller-initiated disputes/read access. Zero automated tests. Not concurrency-safe: two simultaneous refund requests against the same order/item both read `alreadyRefunded` before either writes, so a double-refund racing the over-refund guard is theoretically possible (not reproduced — no test attempted, per read-only mandate). |
| 9 | Disputes | ✅ | ✅ | ✅ | ❌ | ⚠️ | ✅ | `src/lib/refunds.ts::createDispute/getDisputesForOrder/getOpenDisputesForAdmin/resolveDispute`. **Order-specific, not generalized** — `disputes.order_id` is a hard FK, no polymorphic `disputable_type`/`disputable_id` pair exists (unlike `reviews`, which migration 0027 already made polymorphic — confirmed via `docs/ENGINE-8-TRUST-SAFETY-AUDIT.md`). Wired into all three actor perspectives: customer (`api-orders.ts:89`, ownership-enforced via `WHERE id=? AND user_id=?`), seller (`api-seller.ts:430-436`, vendor-ownership-scoped), admin (`api-admin.ts:172-184`, `requirePlatformRole('admin')`-gated). Zero automated tests. |
| 10 | Escrow | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | `grep -rn escrow src/` → matches only `payment_status` string-enum values (`'escrow_held' \| 'released'`) on `orders` and `bookings`. `src/lib/service-orders.ts` (customer_confirmed transition) contains an **explicit code comment admitting no real fund-transfer/settlement logic exists** behind the "release" transition. Per this audit's own evidence standard (documentation/comment/label alone does not count): **escrow does not exist.** |
| 11 | Seller Payouts | ⚠️ schema-only | ❌ | ❌ | ❌ | ❌ | ✅ (schema) | `migrations/0009_seller_portal.sql:110-210` defines `seller_payout_accounts` (AES-256-GCM-encrypted bank details, `PAYOUT_ENCRYPTION_KEY`), `seller_payout_account_audit`, `seller_finance_accounts`, with header comments explicitly naming `src/lib/payouts.ts` and `src/lib/seller-finance.ts` as their intended implementing files. **Neither file exists** — confirmed via `ls`/`grep` across `src/`. `migrations/0014_seller_finance_ledger.sql` (`seller_ledger` table) is explicitly marked "RECONSTRUCTED... DO NOT apply to production... local/dev D1 only" and has **zero** application-code references anywhere. `PAYOUT_ENCRYPTION_KEY` is declared in `src/types.ts` line 4 but referenced nowhere else. This is the clearest EXISTS(schema)=YES / IMPLEMENTED=NO finding in the entire audit. |
| 12 | Provider Payouts (Gigs/Stay/Drive/Send/Eats/Fresh) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | No provider-specific payout table, ledger, or function exists anywhere. `payForBooking()` credits the platform's customer wallet debit into... nothing further — money is debited from the customer, and the booking is marked paid; **there is no corresponding credit to the provider/organization anywhere in `booking-payments.ts`, `booking-lifecycle.ts`, or `wallet.ts`.** Provider identity (migration 0025) and organization identity (migration 0037) exist and are used for *authorization* (who can manage a booking), never for *payout*. This is a structural gap: money currently only ever flows customer→platform, never platform→provider. |
| 13 | Commissions / Fees | ⚠️ partial | ⚠️ partial | ⚠️ partial | ❌ | ❌ | ✅ | `src/lib/service-orders.ts`: `platform_fee_kobo` is a **flat hardcoded 10%**, with an explicit code comment stating a "real Payment Engine would source this from vertical-specific config." `src/lib/affiliate.ts::calculateCommissionBps()` (line 263) returns `affiliate.default_commission_bps` verbatim — no per-category/per-vendor/per-campaign-tier variation is actually computed despite the schema supporting campaign-level overrides (`affiliate_campaigns.commission_type/commission_value` are never read by this function — confirmed by reading the function body, only 2 lines). No booking-side platform fee/commission exists at all (`payForBooking()` charges the customer's deposit percentage of `total_price_kobo` with no separate fee line). No tax handling anywhere. |
| 14 | Affiliate Finance | ✅ | ✅ | ✅ | ❌ | ⚠️ | ✅ | `src/lib/affiliate.ts` (587 lines) — click tracking (`recordClick`), 30-day attribution window, `confirmCommissionsForOrderIfAttributed()` (called from `orders.ts::confirmOrderPayment`, wrapped in try/catch so an affiliate error can never fail a payment), idempotent via `order_items.id` UNIQUE constraint on `affiliate_commissions.order_item_id`. `creditAffiliateLedger`/`debitAffiliateLedger` mirror `wallet.ts`'s exact pattern (own append-only `affiliate_ledger`, **separate from** `wallet_ledger` — a deliberate second ledger, but for a genuinely distinct actor/asset class, not a duplicate of the same concern). `requestAffiliatePayout()` (line 476) creates a `'requested'` row and debits the ledger immediately, but **no route or function ever marks a payout `'paid'`** — confirmed via grep, zero hits for any payout-approval endpoint in `api-admin.ts` or `api-affiliate.ts`. This is the most mature payout-*adjacent* pattern in the repo, useful as an architectural template, but itself incomplete (request-only, no fulfillment). |
| 15 | Currency / Africa | ⚠️ Nigeria-hardcoded | N/A | N/A | N/A | N/A | ✅ | `src/lib/money.ts` — `koboToNaira`/`nairaToKobo`/`formatNaira` are all NGN-specific by name and by the `'₦'`/`'en-NG'` literals; there is no `currency` parameter anywhere in the money module or in `wallet.ts`/`paystack.ts`. `cc_countries.currency_code` column exists (migration 0013, confirmed in `src/lib/country.ts`) and is exposed via `getAllCountries()`, but **is never read by any payment/wallet/money function** — confirmed via `grep -rn "currency_code" src/routes/*.ts src/lib/*.ts`, the only real consumers are `api-account.ts` (a user display preference) and `api-admin.ts` (listing countries in an admin dropdown). Money is correctly integer-kobo internally (never floating point) — that part of the architecture is currency-agnostic-*ready*, but every actual money computation and the Paystack integration itself hardcode NGN/kobo today. |
| 16 | Webhook Security | ⚠️ | ⚠️ | ✅ | ❌ | ❌ | ✅ | `src/routes/api-webhooks.ts` (only webhook in the repo — `grep -rln webhook src/routes/*.ts` → only this file has an actual `.post()` handler, `api-orders.ts`'s hit is a comment). HMAC-SHA512 signature verification: ✅ real (`verifyPaystackWebhookSignature`, Web Crypto). Idempotency: ✅ (`if (tx.status === 'success') return`). **Amount/reference verification against the stored transaction: ❌ — the webhook trusts `event.data.amount` from the payload without comparing it to `payment_transactions.amount_kobo`** (unlike `topup/verify`, which at least re-verifies server-side via `verifyPaystackTransaction`, the webhook path credits directly off the raw event body). **Replay protection: ❌ — no nonce/timestamp/event-id dedup beyond the `status==='success'` check, which is itself non-atomic (see Finding G-2 below).** Currency verification: ❌ (not checked at all — single-currency assumption). |
| 17 | Financial Concurrency | ⚠️ | N/A | N/A | ⚠️ | ⚠️ | N/A | Two live, unfixed risks found (full detail in §5): **G-1** `wallet.ts`'s `creditWallet`/`debitWallet` read-then-write balance with no CAS guard — vulnerable if two *different* concurrent operations (e.g. a refund and a booking payment) hit the same user's wallet simultaneously. **G-2** `api-webhooks.ts`'s Paystack handler does a non-atomic status check before an unconditional UPDATE — same bug class as the just-fixed 8× booking overcharge, genuinely exploitable via Paystack's documented webhook-retry behavior. `orders.ts::confirmOrderPayment()` shares G-2's read-then-branch shape (Component 7). `refunds.ts::createAndExecuteRefund()`'s over-refund guard (Component 8) has the same theoretical race. `booking-payments.ts::payForBooking()` (Component 6) is the **one exception** — already CAS-protected and proven under load. |
| 18 | Financial Security / RBAC | ✅ | ✅ | ✅ | ❌ | ⚠️ | ✅ | Wallet: `requireAuth` only, self-scoped by `c.get('user')!.id` in every query (`api-wallet.ts:9`) — no cross-user wallet access possible by construction. Refund/dispute *admin* actions: `requirePlatformRole('admin')` (`api-admin.ts:35`, checks `user.role`, a **platform-wide** role, not org-scoped). Refund/dispute *seller* read access: `requireSellerVendor` (`api-seller.ts:81-90`), vendor-ownership-enforced at the query level (`WHERE vendor_id = ?`). Refund/dispute *customer* access: ownership-enforced via `WHERE id = ? AND user_id = ?` inside `createDispute`/route lookups. Booking payment authority: `hasProviderAuthorityOverBooking` (current-membership-only, Invariant 7/9 hardened). **No suspended/removed-user financial-access test exists for wallet/refund/dispute paths specifically** — Invariant 9's suspended/removed-member coverage is Booking-scoped only, not re-verified against wallet or refund endpoints in this audit (out of scope to test, per read-only mandate — flagged as a recommended follow-up, not executed here). |
| 19 | Control Center (financial capabilities) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | `api-admin.ts` gives admins moderation, collection, category-attribute, and refund/dispute-resolution capabilities — but **no wallet inspection, no ledger browsing, no fee/commission configuration, no payout approval/rejection UI or API exists anywhere.** The only "Control Center" financial-adjacent surface is `getAllCountries()` (line 211, a read-only country list for a dropdown) — not a financial control at all. |
| 20 | Integration Hub | ⚠️ schema-only | ❌ | ❌ | ❌ | ❌ | ✅ (schema) | `migrations/0023_integration_hub.sql` defines `cc_integrations` (provider_key, status enum `not_configured/configured/healthy/degraded/failed`, `verification_status`, `config_json`), `cc_integration_providers`, `cc_integration_country_overrides` — explicitly marked RECONSTRUCTED from production's live schema. **Zero rows referenced, zero application-code readers/writers** — `grep -rln "cc_integrations\|cc_integration_providers" src/` returns no results. Paystack's actual configuration today is a raw Cloudflare secret (`PAYSTACK_SECRET_KEY`, read directly via `c.env.PAYSTACK_SECRET_KEY` in `api-wallet.ts`/`api-orders.ts`/`api-webhooks.ts`) — completely bypassing the Integration Hub schema that exists specifically to manage provider configuration. CONFIGURED (a secret exists) is not the same as VERIFIED (no evidence a real transaction was ever completed) is not the same as INTEGRATION-HUB-MANAGED (it isn't — it's a bare env var). |
| 21 | Testing | ⚠️ | N/A | N/A | ⚠️ | N/A | ✅ | `tests/` contains **only** `tests/booking-engine/` (9 files, `01`–`09`, Node's built-in `node:test` runner) — **zero dedicated financial/payment/wallet/refund/dispute/affiliate test files exist.** `scripts/` contains `prod_verify.cjs`, `verify_deployment.cjs`, `verify_ecosystem_preview.cjs`, `verify_mobile_menu.cjs`, `verify_signup_fork.cjs`, `gen_seed.py` — all Playwright/HTTP smoke scripts for UI/deployment health, not payment logic; the only wallet-related content found in any of them is `prod_verify.cjs`'s expectation that `/api/wallet` correctly 401s when unauthenticated (an auth-gate check, not a payment-logic test). Booking payments are the only financial code path with real automated test coverage, and only because Booking Invariants 6-9 exercised it as a side effect of hardening the booking state machine, not as a dedicated payment test suite. |
| 22 | Production Deployment | ⚠️ | N/A | N/A | N/A | ❌ | N/A | `curl https://naijadeals.com/api/version` (this session) returns `git_sha: 99b1664df552ce1cd707330e17207d8869f12a4e`, 36 applied migrations, `in_sync: true`, `healthy: true`. **This SHA does not exist in this repository's git history** — re-confirmed this session via `git cat-file -e 99b1664df552ce1cd707330e17207d8869f12a4e` → not found. Production's 36-migration set **includes** `0014_seller_finance_ledger.sql` and `0023_integration_hub.sql` (both schema-only locally) but **stops at migration 0036** — i.e. it predates `0037` (organizations), `0040` (refunds/disputes), and `0041` (booking payments v2, including the just-fixed CAS code). **This audit cannot determine what payment code, if any, production is actually running** — only that it is not this repository's code, and that whatever it is, it was built against an older migration set that lacks the refund/dispute/booking-payment tables this audit evaluated. Deployment status of any of this session's (or Invariant-9's) work: **UNVERIFIED / NOT ESTABLISHED**, consistent with the standing finding in `docs/NAIJADEALS-BASELINE-AUDIT.md` and `docs/ENGINE-1-8-GITHUB-INTEGRITY-AUDIT.md`. |
| 23 | Tests actually executed this session | N/A | N/A | N/A | N/A | N/A | N/A | None. This was a read-only evidence-gathering audit — no test file was run, created, or modified. (Booking 01-09's last executed run, 55/55 PASS, occurred in the prior unit and is cited above only as historical evidence for Component 6.) |

---

## 4. Wallet Semantics — Explicit Determination (Component 4 detail)

Per the audit spec's explicit instruction not to infer semantics from
names alone: the wallet as implemented is a **single-role customer wallet**.
Every one of its seven call sites was individually traced:

| Call site | File | Role of `userId` passed in |
|---|---|---|
| Topup credit | `api-wallet.ts` (`/topup/verify`) | The authenticated customer topping up their own balance |
| Order payment debit | `orders.ts::payOrderFromWallet` | The customer paying for their own order |
| Booking payment debit | `booking-payments.ts::payForBooking` | The customer paying for their own booking |
| Order refund credit | `refunds.ts::createAndExecuteRefund` | The customer (`order.user_id`) receiving a refund |
| Booking cancellation refund credit | `booking-cancellation.ts` | The customer (`existing.customer_user_id`) receiving a refund |
| Settlement debit (additional charge) | `order-settlement.ts::confirmAdditionalChargePayment` | The customer paying an additional weight-based charge |
| Webhook topup credit | `api-webhooks.ts` | The customer (`tx.user_id`) whose topup webhook fired |

**No call site ever passes a seller_id, vendor_id, provider_id, or
organization_id into `creditWallet`/`debitWallet`.** There is no
seller/provider/platform wallet anywhere in the codebase — confirming
Component 12's finding that money currently only flows customer→platform,
never platform→seller/provider.

---

## 5. Critical Findings, Categorized A–I

### A. COMPLETE / VERIFIED
- **A-1.** `payForBooking()`'s CAS-protected payment claim (Component 6) —
  proven correct under 55/55 full-suite runs (twice), including the exact
  concurrent-race scenario it was built to prevent.
- **A-2.** Paystack webhook signature verification (`verifyPaystackWebhookSignature`,
  HMAC-SHA512 via Web Crypto) — cryptographically correct implementation,
  confirmed by direct code read.

### B. PARTIAL
- **B-1.** Refunds/disputes (Components 8-9) — fully integrated across
  three actor perspectives, zero over-refund possible under sequential
  access, but no automated test coverage and a theoretical concurrent
  double-refund race (see G-3 below).
- **B-2.** Affiliate finance (Component 14) — commission attribution and
  ledger crediting are solid and idempotent; payout *request* exists but
  payout *fulfillment* (marking paid, admin approval) does not.

### C. EXISTS BUT NOT INTEGRATED
- **C-1.** `cc_integrations`/`cc_integration_providers` (Integration Hub,
  Component 20) — full schema, zero code.
- **C-2.** `seller_payout_accounts`/`seller_finance_accounts`/`seller_ledger`
  (Component 11) — full schema (including AES-256-GCM encryption design),
  zero code.
- **C-3.** `cc_countries.currency_code` (Component 15) — column exists,
  populated, never read by any money/payment function.

### D. INTEGRATED BUT NOT VERIFIED
- **D-1.** Paystack transaction initialization/verification (Component 2)
  — code is real and correctly structured, but no evidence exists in this
  repository (test, log, script output) that a real Paystack transaction
  has ever been successfully completed end-to-end.

### E. MISSING
- **E-1.** Escrow as an actual fund-transfer/hold mechanism (Component 10).
- **E-2.** Seller payouts, any execution layer (Component 11).
- **E-3.** Provider payouts for any of Gigs/Stay/Drive/Send/Eats/Fresh
  (Component 12).
- **E-4.** A second payment provider (Component 3).
- **E-5.** Multi-currency computation anywhere in `money.ts`/`wallet.ts`
  (Component 15).
- **E-6.** Control Center financial dashboard/controls (Component 19).
- **E-7.** Dedicated financial/payment automated test suite (Component 21).
- **E-8.** Affiliate payout fulfillment/approval (Component 14).

### F. SECURITY RISKS
- **F-1.** Paystack webhook (Component 16) credits/confirms off the raw
  event payload's `amount`/`reference` without cross-checking against the
  stored `payment_transactions.amount_kobo` — a compromised or malformed
  (not just replayed) webhook payload could, in principle, confirm a
  payment for a different amount than was actually charged. Not exploited
  or tested here per the read-only mandate; flagged as a design gap.
- **F-2.** `PAYOUT_ENCRYPTION_KEY` is declared in `src/types.ts` but has no
  implementing code anywhere — not itself a vulnerability today (nothing
  uses it), but a dangling secret declaration that should be tracked so a
  future payout implementation doesn't silently skip the encryption it
  implies.

### G. CONCURRENCY RISKS
- **G-1.** `wallet.ts::creditWallet()`/`debitWallet()` (Component 4/17) —
  read `getWalletBalance()` outside any CAS guard, then write via
  `db.batch()`. Two *different* concurrent financial operations against
  the same `userId` (e.g. a refund landing at the same instant as a
  booking payment) can both read the same stale balance and each compute
  an independent `newBalance`, with the second write silently overwriting
  the first's ledger-implied balance. The booking-payment CAS fix
  (Invariant 9) protects re-entrant calls into the *same* booking's
  payment flow but does **not** protect this shared primitive from
  cross-source races.
- **G-2.** `api-webhooks.ts`'s Paystack handler (Component 16/17) checks
  `tx.status === 'success'` then performs a **non-atomic** unconditional
  `UPDATE` before crediting — the exact TOCTOU class just fixed in
  Booking Invariant 9, left unfixed here per this unit's explicit
  read-only mandate. Paystack does perform webhook retries on non-2xx or
  timeout responses, making duplicate delivery a realistic (not merely
  theoretical) trigger.
- **G-3.** `orders.ts::confirmOrderPayment()` (Component 7) shares G-2's
  read-then-branch shape (`if (order.payment_status !== 'unpaid') return`)
  with no CAS claim before the `db.batch()` write.
- **G-4.** `refunds.ts::createAndExecuteRefund()` (Component 8) computes
  `remaining = capturedKobo - alreadyRefunded` by reading existing refund
  rows, then inserts a new refund — two concurrent refund requests against
  the same order/item could both read the same `alreadyRefunded` and both
  pass the over-refund check, together exceeding the captured amount.

### H. ARCHITECTURAL DEBT
- **H-1.** Flat hardcoded 10% platform fee in `service-orders.ts`, with the
  code's own comment acknowledging it needs to become vertical-specific
  configuration.
- **H-2.** Two independent, structurally-identical-but-separate ledgers
  (`wallet_ledger` for customers, `affiliate_ledger` for affiliates) with
  no shared abstraction — acceptable today (distinct actor/asset classes)
  but a maintenance-cost signal if a third ledger (seller, provider) is
  added without first extracting the common "append-only ledger + cached
  balance" pattern into a shared module.
- **H-3.** Currency/money layer is structurally single-currency
  (`koboToNaira`, `'₦'`/`'en-NG'` literals hardcoded) despite a
  currency-aware `cc_countries` table already existing — the two systems
  were never connected, so "Africa-ready" is not yet true of the money
  layer despite being true of the country/catalog layer.

### I. ENGINE 7 BLOCKERS
- **I-1.** G-1 and G-2 (wallet primitive race, webhook non-CAS write) must
  be fixed **before** any new payment feature is layered on top of
  `creditWallet`/`debitWallet` or the webhook handler — building payouts or
  escrow on top of an unprotected shared-balance primitive would multiply,
  not isolate, the blast radius of a race.
- **I-2.** Seller/provider payout execution has zero code and zero design
  decision on file for *how* funds actually move (bank transfer via which
  provider/API — Paystack Transfers API was not found referenced
  anywhere) — this is a design question, not just an implementation gap,
  and must be resolved before `src/lib/payouts.ts` can be written.
- **I-3.** Escrow, if genuinely required, needs an explicit hold/release
  fund-movement mechanism designed from scratch — today's `escrow_held`/
  `released` values are booking-state labels only and provide no actual
  fund-custody guarantee to build payouts on top of.

---

## 6. Missing Capabilities (Summary)

1. Real escrow (hold + release fund movement)
2. Seller payout execution (bank transfer, approval workflow, fraud checks)
3. Provider payout execution (all six verticals)
4. A second payment provider (Flutterwave or other)
5. Multi-currency money computation
6. Control Center financial dashboard (wallet/ledger inspection, fee
   configuration, payout approval)
7. Integration Hub wiring for Paystack configuration (currently a bare env
   var, bypassing the schema built for this)
8. Dedicated financial automated test suite
9. Affiliate payout fulfillment (approval + "paid" marking)
10. Webhook amount/reference cross-verification against stored transaction

---

## 7. Recommended Implementation Order (for Engine 7 planning — NOT started)

1. **Fix G-1 and G-2 first**, as an isolated hardening pass (mirrors
   Invariant 9's own pattern) — before any new feature work, since every
   later item builds on `creditWallet`/`debitWallet` and the webhook path.
2. **Design and build the seller/provider payout ledger + execution layer**
   on top of the existing `seller_ledger`/`seller_payout_accounts` schema
   (already reconstructed — reuse, don't re-design), using
   `affiliate.ts`'s request/ledger pattern as the architectural template,
   extended to actually reach a "paid" terminal state via a real transfer
   API call.
3. **Wire Integration Hub** (`cc_integrations`) as the actual source of
   Paystack (and any future provider's) configuration, replacing the bare
   `PAYSTACK_SECRET_KEY` env-var pattern, so CONFIGURED becomes a real,
   auditable state rather than "a secret exists somewhere."
4. **Design real escrow** only if the business genuinely requires holding
   customer funds separately before provider release (vs. today's
   "pay now, release later" wallet-debit-then-label-change model) — this
   is a product decision as much as an engineering one and should be
   confirmed with Pat before design work starts.
5. **Add a dedicated financial test suite** (`tests/payment-engine/`,
   mirroring `tests/booking-engine/`'s structure) covering wallet
   concurrency, webhook idempotency/replay, refund double-issuance, and
   payout state transitions — ideally written *before* new payout code,
   not after, given what Booking Invariant 9 revealed about how much a
   full-suite concurrent run can surface that isolated tests miss.
6. **Currency/Africa expansion** (multi-currency money layer) — lowest
   priority; NaijaDeals is Nigeria-only in practice today and this is
   correctly deferred per the audit spec's own "do not add FX during this
   audit" instruction.

---

## 8. Explicit Verified vs. Unverified Distinction

**VERIFIED (real evidence of execution):**
- `payForBooking()`'s CAS fix — 55/55 automated test pass, twice, including
  the exact race scenario.
- Paystack HMAC-SHA512 signature verification — verified by code
  inspection (cryptographically correct construction), not by a live
  transaction.
- Production is live and healthy at `naijadeals.com` — verified by direct
  `curl` this session.

**CONFIGURED BUT NOT VERIFIED:**
- Paystack initialize/verify/webhook flow — code is real; no evidence any
  of it has ever processed a real transaction.
- `PAYSTACK_SECRET_KEY` — referenced correctly in code; presence/validity
  in any actual environment (local `.dev.vars` or Cloudflare secret) was
  not checked (out of scope for a read-only code/schema audit).

**NOT VERIFIED / NOT ESTABLISHED:**
- Whether any of this repository's payment code (Booking or Marketplace)
  is actually running in production — production's `git_sha` does not
  exist in this repository's history.
- Whether refunds, disputes, or affiliate commissions have ever fired
  against a real order in any environment — no test or log evidence
  exists either way.

---

## 9. GitHub Checkpoint

Before commit: `git status`, `git diff`, `git diff --stat` were run —
confirmed the only change is this new file (`docs/ENGINE-7-PAYMENT-FINANCE-AUDIT.md`),
zero modifications to any existing file.

(Commit/push/fetch/3-way-SHA-verification results are reported in the
Final Report delivered alongside this document, per the audit spec's
required output format.)
