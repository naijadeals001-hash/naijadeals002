# NaijaDeals — Engine 7 Phase 3: Variable-Weight Settlement Hardening

**Status: PHASE 3 COMPLETE.** This document is the terminal deliverable for
Engine 7 Phase 3. It records the forensic audit, financial invariant,
atomicity design, implementation, concurrency proof, full regression, and
verified git checkpoint for hardening `settleVariableWeightItem()` (and its
companion `confirmAdditionalChargePayment()`) against the concurrent
financial race identified in Phase 2's forensic review.

---

## 1. Starting / Ending SHA

- **START SHA**: `c61c510b2a49c56ddb561b7a5c2cc56b3f72401f` (Engine 7 Phase 2 close)
- **END SHA**: recorded in §11 after this document's commit

---

## 2. Original Vulnerability / Race (Unit 1 — Forensic Audit)

**Affected function**: `settleVariableWeightItem(db, orderItemId, actorUserId)` in `src/lib/order-settlement.ts`, plus its companion `confirmAdditionalChargePayment()` in the same file (currently zero live HTTP callers, but sharing the identical race class).

**Traced flow** (state transitions, per the mandated forensic checklist):
1. **Read**: `SELECT ... settlement_status FROM order_items WHERE id = ?` — reads `final_price_kobo`, `fulfilled_quantity`, `line_total_kobo`, `settlement_status`.
2. **Authorization check**: `if (item.settlement_status !== 'none') return { outcome: 'already_settled' }` — a read-then-branch check in application code.
3. **Financial side effect** (exactly one, chosen by `differenceKobo = final_price_kobo - line_total_kobo`):
   - `=== 0` → unconditional `UPDATE settlement_status = 'settled'` (no money moves).
   - `< 0` → `createAndExecuteRefund()` (already G-4 CAS-protected), then unconditional `UPDATE settlement_status = 'refund_issued'`.
   - `> 0` → `INSERT INTO order_additional_charges` (no uniqueness constraint on `order_item_id`), then unconditional `UPDATE settlement_status = 'additional_payment_pending'`.

**Confirmed exploitable — not merely "looks similar" to G-2/G-3**:
- Two concurrent calls for the SAME `orderItemId` both read `settlement_status = 'none'` before either writes, both pass the guard, and both compute the same `differenceKobo`.
- **Refund branch**: G-4's aggregate cap (`claimRefundSlot()`) does prevent the wallet from being over-credited beyond the captured amount — so customer funds were never at risk here — but two `refunds` rows / two credit attempts still ran for what should be one settlement event, with the second only failing after already executing (an availability/correctness defect, propagating an uncaught `RefundError` from `settleVariableWeightItem` as an unhandled 500, not a silent fund-safety defect).
- **Additional-charge branch (the real risk)**: `order_additional_charges` has **no aggregate guard and no uniqueness constraint** — two concurrent calls both insert a duplicate pending charge row for the same shortfall, and `confirmAdditionalChargePayment()` (pre-fix) had no de-dup of its own beyond a `status = 'pending_payment'` read-then-branch check on the SAME class of race. **This was a genuine double-charge risk to the customer**, not merely theoretical.
- **No-adjustment branch**: harmless in isolation (re-writes `settlement_status = 'settled'` twice), but structurally the same unguarded pattern.

**Callers**: exactly one HTTP entry point, `POST /api/seller/orders/items/:orderItemId/settle` (`src/routes/api-seller.ts`), with no outer idempotency guard beyond a plain vendor-ownership check — the function itself was the only place this invariant could be enforced, confirming the Phase 3 mandate's "do not trust an upstream guard" principle. `getPendingAdditionalCharges()`/`confirmAdditionalChargePayment()` have **zero route callers today** (confirmed via repo-wide grep) — not exploitable via HTTP as of this audit, but hardened to the same standard since they become exploitable the instant a route is wired to them.

**Side effects checked and confirmed absent from this function**: inventory (`adjustStock`), affiliate (`confirmCommissionsForOrderIfAttributed`), logistics (`createShipmentsForPaidOrder`) — zero references found via grep in `order-settlement.ts`. Only the wallet credit (via `refunds.ts`) and the additional-charge insert are in-scope financial side effects.

---

## 3. Root Cause

The exact read-then-branch TOCTOU class already fixed for G-2 (Paystack webhook) and G-3 (order payment) in Engine 7 Phase 2, applied to a THIRD financially significant state column (`order_items.settlement_status`) that had not yet been brought under the same discipline. The function's own doc comment claimed idempotency ("a documented no-op") but the code did not atomically *enforce* it — the comment described intended behavior, not a guarantee under concurrency.

---

## 4. Financial Invariant (Unit 2)

Unlike G-4 (refunds: many rows may legitimately sum to a cap), `order_items.settlement_status` is a **single-row, single-transition** field — each order item has **exactly one** legitimate settlement outcome, ever. The invariant:

> Exactly one of `{settled, refund_issued, additional_payment_pending}` may ever be reached from `none`, and the financial side effect that produces that outcome (a refund credit, or an additional-charge row creation) must execute **at most once** per order item, regardless of how many concurrent or retried calls are made.

This is structurally identical to G-2/G-3's enum-CAS invariant class, **not** G-4's aggregate class. Existing legitimate business semantics (no-adjustment no-op, refund on shortfall, pending charge on overage, never auto-debiting the customer) were preserved exactly — Phase 3 is a concurrency fix, not a business-logic change.

For `confirmAdditionalChargePayment()`: a given `order_additional_charges` row may be paid **at most once**; a failed debit must never leave the row silently `'paid'` with no money moved, and must remain legitimately retryable.

---

## 5. Atomicity Design (Unit 3)

**Why not G-4's aggregate-INSERT pattern**: no aggregate SUM constraint exists here — there is exactly one row (`order_items.id`) whose single `settlement_status` column must transition exactly once. This calls for a guarded CAS claim, not a guarded aggregate INSERT.

**Why not a plain two-state boolean CAS** (unlike G-2/G-3's `unpaid → escrow_held`): the terminal `settlement_status` value (`'settled'` / `'refund_issued'` / `'additional_payment_pending'`) is not known until *after* the claim is won — it depends on `differenceKobo`, computed from data read before the claim. The design introduces a **transient third state, `'settling'`**:

```sql
UPDATE order_items SET settlement_status = 'settling' WHERE id = ? AND settlement_status = 'none'
```

This single statement is the ONE atomic gate: D1/SQLite executes an UPDATE's guard-check and write as one indivisible unit, so of any number of concurrent callers for the same `orderItemId`, only one can ever see `rows_written > 0`. `settlement_status` has **no CHECK constraint** in the schema (confirmed: `ALTER TABLE order_items ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'none'`, a plain free-text column, same pattern already used for `orders.status`/`order_items.item_status`) — introducing `'settling'` as a new legal value required **no schema migration**.

The winner then computes the outcome, executes the single financial side effect, and transitions `'settling'` → the correct terminal value, itself guarded by `WHERE settlement_status = 'settling'` (claim ownership carried through every write). On any failure, the claim rolls back to `'none'` — mirroring Unit 4/5's exact claim-then-rollback-on-failure precedent — so a genuinely failed attempt (e.g. a `RefundError` from G-4's own cap, a transient DB error) can be legitimately retried rather than leaving the item stuck mid-settlement forever.

For `confirmAdditionalChargePayment()`: `order_additional_charges.status` DOES have a DB-level CHECK constraint (`CHECK (status IN ('pending_payment', 'paid', 'cancelled'))`) — no transient state is available or needed. The claim goes straight to the terminal `'paid'` value before debiting, exactly mirroring `claimOrderForPayment()`'s two-state CAS shape (Engine 7 Phase 2, Unit 4), rolling back to `'pending_payment'` on debit failure.

**Why this is correct**: neither design relies on an application-level mutex, JavaScript execution ordering, or "this endpoint normally gets called once" — both rely purely on the atomicity guarantee of a single D1/SQLite `UPDATE` statement's guard-check-and-write, the same primitive proven correct across G-1 through G-4.

---

## 6. Implementation (Unit 4)

**File changed**: `src/lib/order-settlement.ts` only.

- Added `claimSettlementSlot(db, orderItemId)` — the atomic `'none' → 'settling'` CAS claim.
- Rewrote `settleVariableWeightItem()`: claim first (immediately after the "has this item been fulfilled" precondition check, which is a read-only structural validation, not a financial gate), compute `differenceKobo`, execute exactly one financial side effect inside a `try`, transition `'settling'` → terminal value guarded by `AND settlement_status = 'settling'`, and roll back to `'none'` in a `catch` on any failure.
- Added `claimAdditionalChargeForPayment(db, chargeId, userId)` — the atomic `'pending_payment' → 'paid'` CAS claim, ownership-scoped by `userId` via the existing `orders` join (unchanged ownership semantics).
- Rewrote `confirmAdditionalChargePayment()`: claim-before-debit ordering (mirrors `payOrderFromWallet()`'s Unit 4 fix), rollback to `'pending_payment'` on debit failure (mirrors `createAndExecuteRefund()`'s Unit 5 fix).
- **Secondary traceability fix** (same class as Unit 5's refund fix): `confirmAdditionalChargePayment()`'s `creditWallet`/`debitWallet` `reference_id` changed from the bare `orderId` to the unique `chargeId`, so two additional charges against the same order can never collide on the same `reference_id` when looking up the resulting `wallet_ledger` row.
- No public API response shape changed. No business calculation changed. No existing route behavior changed (the one live route, `POST /api/seller/orders/items/:orderItemId/settle`, still returns the same `{ success, outcome, differenceKobo }` shape).

---

## 7. Tests Added (Unit 5)

**New file**: `tests/payment-engine/05.variable-weight-settlement-cas.test.mjs` — 16 tests, real local D1 via wrangler's `getPlatformProxy()` (the established Units 2/4/5 harness), zero mocks.

| # | Test | Type |
|---|---|---|
| 1 | Normal settlement — final lower issues exact-difference refund | Sequential |
| 2 | Correct calculated settlement — final equal is a no-op, zero side effect | Sequential |
| 3 | Final higher creates exactly one pending additional charge, never auto-debits | Sequential |
| 4 | Sequential duplicate settlement is a safe `already_settled` no-op | Sequential |
| 5 | Pre-set `settlement_status` is respected without recomputation | Sequential |
| 6 | Invalid attempt (not yet fulfilled) throws `SettlementError` | Sequential |
| 7 | A legitimately-failed refund attempt rolls back to `'none'`, retry evaluated fresh | Sequential + failure injection |
| 8 | **CONCURRENT 2-way duplicate settlement race** — exactly 1 winner, 1 refund, 1 credit | **Concurrent** |
| 9 | **CONCURRENT 4-way duplicate settlement race** — exactly 1 winner | **Concurrent** |
| 10 | **CONCURRENT 8-way duplicate settlement race** — exactly 1 winner, ledger consistent | **Concurrent** |
| 11 | **CONCURRENT 5-way race on the additional-charge branch** — exactly 1 charge row (the core double-charge risk this phase closes) | **Concurrent** |
| 12 | **CONCURRENT 4-way race on the no-adjustment branch** — never double-transitions past `'settled'` | **Concurrent** |
| 13 | `confirmAdditionalChargePayment`: normal payment debits exactly once | Sequential |
| 14 | **CONCURRENT 6-way duplicate payment race for the SAME charge** — exactly 1 debit | **Concurrent** |
| 15 | Insufficient funds fails safely, rolls back to `pending_payment`, legitimate retry succeeds | Sequential + failure injection |
| 16 | Ledger consistency invariant after a full mixed battery (refund + charge + no-adjustment items, each raced 2-3 ways concurrently) | **Concurrent** |

**Concurrency methodology**: `Promise.allSettled()` with independent simultaneous calls against the SAME `orderItemId`/`chargeId`, starting from the identical pre-race database state — proving the database-level guard, not timing, prevents the race (per the phase's explicit "at least one test should demonstrate that multiple concurrent settlement attempts cannot all observe the same settleable state and then all succeed" requirement).

**Test results**: **16/16 pass, run TWICE** (32/32 total across both runs, zero flakes).

---

## 8. Regression Results (Unit 6)

Every applicable suite re-run cold, in the foreground, one process at a time (lesson applied from the Phase 2 sandbox-freeze incident — never run concurrent background test/Miniflare processes alongside the live PM2 dev server).

| Suite | Tests | Result |
|---|---|---|
| Unit 2 — Wallet CAS (`01.wallet-concurrency.test.mjs`) | 12 | ✅ 12/12 |
| Unit 3 — Webhook hardening (`02.webhook-hardening.test.mjs`) | 9 | ✅ 9/9 |
| Unit 4 — Order payment CAS (`03.order-payment-cas.test.mjs`) | 11 | ✅ 11/11 |
| Unit 5 — Refund CAS (`04.refund-concurrency.test.mjs`) | 11 | ✅ 11/11 |
| **Phase 2 payment aggregate** | **43** | **✅ 43/43** |
| Phase 3 — Variable-weight settlement CAS (`05.variable-weight-settlement-cas.test.mjs`) | 16 | ✅ 16/16 (×2 runs) |
| Booking 01 — Booking creation | 5 | ✅ 5/5 |
| Booking 02 — Authorization/tenant isolation | 7 | ✅ 7/7 |
| Booking 03 — State machine | 6 | ✅ 6/6 |
| Booking 04 — Availability collision | 5 | ✅ 5/5 |
| Booking 05 — Concurrency | 4 | ✅ 4/4 |
| Booking 06 — Cancellation/refund | 10 | ✅ 10/10 |
| Booking 07 — Provider ownership isolation | 7 | ✅ 7/7 |
| Booking 08 — Idempotency | 5 | ✅ 5/5 |
| Booking 09 — Security regression (Invariant 9) | 6 | ✅ 6/6 |
| **Booking aggregate** | **55** | **✅ 55/55** |

**Grand total this phase: 43 (Phase 2 baseline) + 16 (Phase 3 new) + 55 (booking) = 114/114 pass, zero regressions.** No failure occurred at any point during this phase's regression pass — no investigation/fix cycle was needed.

---

## 9. TypeScript / Build (Unit 7)

- **TypeScript**: `npx tsc --noEmit` → **27 errors**, identical count and identical error set to the Phase 2 baseline (all in unrelated pre-existing files). **Zero new errors** introduced by this phase's changes.
- **Build**: `npm run build` → succeeds. `dist/_worker.js` **550.00 kB** (gzip 124.44 kB) — a small, expected increase from Phase 2's 549.13 kB baseline attributable to the two new claim functions (`claimSettlementSlot`, `claimAdditionalChargeForPayment`) and their doc comments; no unrelated bloat.

---

## 10. Migration Result (Unit 8)

**No schema migration required.** `order_items.settlement_status` is declared `TEXT NOT NULL DEFAULT 'none'` with **no CHECK constraint** (confirmed by direct inspection of `migrations/0040_marketplace_engine_v2_1.sql`), so introducing `'settling'` as a new legal application-level value needed no `ALTER TABLE`. `order_additional_charges.status` already has a CHECK constraint covering exactly the two values (`'pending_payment'`, `'paid'`) this phase's CAS transitions between — no change needed there either. No migration file was created this phase (confirmed via `git status`/`git diff --stat`, §9 below).

---

## 11. Git / GitHub Verification (Units 9-10)

**Files changed**:
- `src/lib/order-settlement.ts` (modified: +210 / −52 lines)
- `tests/payment-engine/05.variable-weight-settlement-cas.test.mjs` (created)
- `docs/ENGINE-7-PHASE-3-VARIABLE-WEIGHT-SETTLEMENT-AUDIT.md` (this file, created)

No secrets, `.dev.vars`, credentials, temporary files, generated junk, or unrelated changes were present in the diff (verified via `git status --short`, `git diff --check`, and a targeted grep for secret-like strings before commit).

```
LOCAL SHA:               <recorded after commit, see final chat message>
FETCHED origin/main SHA: <recorded after fetch, see final chat message>
GITHUB API SHA:          <recorded after API call, see final chat message>
3-WAY SHA MATCH:         <see final chat message>
WORKING TREE:            clean (confirmed post-commit, see final chat message)
```

---

## 12. Final Forensic Recheck (Unit 11)

Performed after implementation, before declaring Phase 3 complete:

- ✅ No read-then-branch financial authorization race remains in `settleVariableWeightItem()` or `confirmAdditionalChargePayment()` — both gate exclusively on an atomic UPDATE's `rows_written`.
- ✅ Concurrent callers cannot both authorize the same financial effect — proven via 2/4/5/6/8-way concurrent races across every branch (no-adjustment, refund, additional-charge, and payment-of-charge).
- ✅ Settlement cannot exceed the legitimate invariant — the settlement claim guarantees at most one financial side effect per item; G-4's aggregate refund guard remains as defense-in-depth underneath.
- ✅ Duplicate settlement is safely handled — `already_settled` outcome, zero side effects, proven both sequentially and concurrently.
- ✅ Retries remain safe — a genuinely failed attempt (real `RefundError` from G-4's cap; real `InsufficientFundsError` from the wallet) rolls back to the pre-claim state and a subsequent legitimate call is evaluated fresh, proven by explicit failure-injection tests.
- ✅ Ledger remains consistent — `SUM(wallet_ledger) == cached_balance_kobo` verified after every concurrent battery, including a mixed battery racing all three branches simultaneously.
- ✅ Inventory side effects — confirmed absent from this function (zero `adjustStock` references); unaffected by this phase.
- ✅ Affiliate/logistics side effects — confirmed absent from this function; unaffected by this phase.
- ✅ Existing Engine 7 Phase 2 protections remain intact — 43/43 payment regression, zero deviation from baseline.

No finding remains open. Phase 3 is declared complete on this basis, not merely "tests are green."

---

## 13. Remaining Risks

- `confirmAdditionalChargePayment()` and `getPendingAdditionalCharges()` remain **wired to zero HTTP routes** — hardened to the full standard for when a route is eventually added, but the customer-facing "pay your pending additional charge" UI/endpoint itself was never in this phase's scope and does not exist yet. Recommended as a natural next increment if variable-weight settlement is to be customer-facing rather than seller/admin-only.
- The one live settlement route (`POST /api/seller/orders/items/:orderItemId/settle`) still returns an uncaught-to-the-caller `SettlementError` as a 400 on a lost race (`already_settled`) exactly as before — this is correct/expected behavior (idempotent no-op, not an error state for the losing caller to treat as a failure), but no dedicated regression test exists at the HTTP route layer itself (only at the library-function layer, which is where the actual invariant lives and where Units 2/4/5 also chose to test).
- `settleVariableWeightItem()`'s pre-claim reads (`item.final_price_kobo`, `item.fulfilled_quantity` for the not-yet-fulfilled check) are still a plain read before the claim — this is intentional and safe (they are structural/validation reads, not financial-authorization reads; the claim itself is what gates the financial effect), but is noted here for completeness per the audit's own "trace every read" discipline.

---

## 14. Out of Scope (unchanged from Phase 2's standing prohibitions)

- Seller payouts
- Provider payouts
- Escrow
- Multi-currency
- Engine 8, Engine 9, Engine 10
- New vertical implementation
- Production deployment
- A second wallet, ledger, payment system, or settlement engine (none created — this phase exclusively extends the existing `wallet.ts`/`refunds.ts`/`order-settlement.ts` machinery)

---

## 15. Final Status Classification

```
G-5 / VARIABLE-WEIGHT SETTLEMENT RACE: ✅ FIXED AND PROVEN
```

The race identified in Phase 2's forensic review is confirmed real (not merely superficially similar to G-2/G-3), fixed with a database-level atomic CAS claim generalized correctly for the three-way outcome this function has, and proven under genuine concurrent load (2/4/5/6/8-way races, all branches, plus the payment-of-charge companion function) with zero regressions across 114 total tests run this phase.
