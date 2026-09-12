# NaijaDeals — Engine 7 Phase 2: Financial Hardening
## Unit 1 — Pre-Implementation Forensic Review (READ-ONLY)

**Status:** AUDIT ONLY. No code, schema, or test file was modified while
producing this document. This is the mandatory pre-implementation review
required before Units 2-6 (wallet/webhook/order/refund hardening) may begin.

**Date:** 2026-09-12
**SHA at time of this review (start = end, no code changed):** `4b683ff280bde2231f92c9928fa310781e7ef5bd`
**Branch:** `main`
**Working tree at start:** CLEAN

**Method:** Full reads of every named target file, migration-by-migration
schema inspection of every table involved, a live probe of the local D1
engine's SQL feature set (does it support `RETURNING`?), and a read of the
test-harness conventions already established in `tests/booking-engine/`.
No implementation code was written.

---

## A. Current Wallet Balance Mutation Semantics

**File:** `src/lib/wallet.ts` (108 lines, full read).

`creditWallet()` and `debitWallet()` share an identical shape:

```
await ensureWalletAccount(db, userId)          // INSERT OR IGNORE, safe/idempotent
const current = await getWalletBalance(db, userId)   // separate SELECT — NOT locked
const newBalance = current +/- amountKobo
if (debit && current < amountKobo) throw InsufficientFundsError()
await db.batch([ INSERT wallet_ledger, UPDATE wallet_accounts SET cached_balance_kobo = newBalance ])
```

**The race window is exactly between the `SELECT` in `getWalletBalance()`
and the `db.batch()` write** — nothing holds a lock or claims a row in
between. Two concurrent calls for the same `userId` (regardless of
`referenceType`) can both read the same `current`, both compute an
independent `newBalance` based on that stale read, and the second `batch()`
to complete simply overwrites the first's cache value — the ledger gets
TWO correct-looking rows (each internally consistent amount/description),
but `wallet_accounts.cached_balance_kobo` ends up reflecting only the
LAST writer's math, silently losing one side of the update ("lost update"
class race). This matches Booking Invariant 9's finding pattern exactly,
transplanted from `bookings.payment_status` to `wallet_accounts.cached_balance_kobo`.

**Confirmed: `db.batch()` is atomic for the two statements inside it**
(ledger insert + cache update happen together or not at all) — the race is
in the *read that determines what to write*, not in the write's own
atomicity. This means the fix pattern must be an atomic *conditional*
write (CAS on the balance value itself), not a switch to `db.batch()`
(already used) — mirroring `payForBooking()`'s `UPDATE ... WHERE
payment_status = 'unpaid'` pattern, but for a *numeric* value instead of
an enum.

## B. Wallet Ledger Semantics

**Schema:** `migrations/0001_initial_schema.sql:183-193` (`wallet_ledger`),
`:199-203` (`wallet_accounts`).

```sql
CREATE TABLE wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  entry_type TEXT NOT NULL,          -- credit | debit
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
  balance_after_kobo INTEGER NOT NULL,
  reference_type TEXT NOT NULL,      -- topup | order_payment | refund | payout | escrow_release
  reference_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE wallet_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  cached_balance_kobo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- `wallet_ledger` is append-only (no application code ever UPDATEs or
  DELETEs a row — confirmed via `grep -n "UPDATE wallet_ledger\|DELETE FROM wallet_ledger" src/`,
  zero hits).
- `amount_kobo` has a DB-level `CHECK (amount_kobo > 0)` — a debit is
  stored as a positive number tagged `entry_type='debit'`, never a
  negative amount. Any hardening fix must preserve this: never write
  `amount_kobo <= 0`.
- **No UNIQUE constraint exists anywhere on `wallet_ledger`** — nothing at
  the schema level prevents a duplicate `(reference_type, reference_id)`
  pair from being inserted twice. This is relevant to Unit 3 (webhook
  idempotency): the current guard is entirely at the `payment_transactions.status`
  application layer, not at the ledger's own schema.
- `balance_after_kobo` is a point-in-time snapshot written by the ledger
  insert itself — it must stay mathematically consistent with the CAS fix
  (i.e., still equal to the value `cached_balance_kobo` is set to in the
  same batch).

## C. Transaction Status Vocabulary

**Schema:** `migrations/0001_initial_schema.sql:207-218` (`payment_transactions`).

```sql
CREATE TABLE payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),      -- NULL = wallet topup, not an order payment
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,             -- paystack | wallet
  provider_reference TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated', -- initiated | success | failed
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payment_tx_reference ON payment_transactions(provider_reference);
CREATE INDEX idx_payment_tx_order ON payment_transactions(order_id);
```

- `provider_reference` has an **index but NOT a UNIQUE constraint** —
  confirmed via `grep -n "payment_transactions" migrations/*.sql`, only
  the two indexes above exist, no `ALTER TABLE ... ADD CONSTRAINT` and no
  `CREATE UNIQUE INDEX` anywhere for this table across all 43 migrations.
  This is a real gap: two INSERTs with the same `provider_reference`
  (e.g. a client-side race re-submitting `/topup/initialize`) could
  currently create two distinct `payment_transactions` rows referencing
  the same Paystack reference, and the webhook's `SELECT ... WHERE
  provider_reference = ?` would only ever find/update ONE of them
  (whichever the `first()` call happens to return), leaving the other
  permanently `'initiated'`. Fixing this is in-scope for Unit 3 (webhook
  hardening) since it directly affects idempotency guarantees, but the
  actual schema change (unique index) will need to be added as part of
  that unit, not deferred.
- `status` has three legal values only by *convention* (no DB
  `CHECK` constraint on this column, unlike `refunds.status`/`disputes.status`
  which do have `CHECK (status IN (...))` — see §F below). The existing
  idempotency guard (`if (tx.status === 'success') return`) relies on
  this convention holding, application-side only.

## D. Paystack Webhook Flow

**File:** `src/routes/api-webhooks.ts` (48 lines, full read — this session
and this audit's prior Phase 1 pass).

Exact current sequence:
1. Read `PAYSTACK_SECRET_KEY` from env; 503 if absent.
2. Read raw body text (needed verbatim for HMAC verification — correctly
   read BEFORE any JSON parsing).
3. Verify `x-paystack-signature` via `verifyPaystackWebhookSignature()`
   (`src/lib/paystack.ts`, HMAC-SHA512 via Web Crypto `crypto.subtle`) — 401
   on failure. **This is cryptographically sound and will be preserved
   unchanged.**
4. Parse JSON body. Ignore any `event.event !== 'charge.success'`.
5. Read `reference`/`amountKobo` directly off `event.data` — **no
   cross-check against the stored `payment_transactions` row's own
   `amount_kobo` happens anywhere** (confirmed: `amountKobo` is used ONLY
   in the final `creditWallet()` call for the no-`order_id` branch; the
   `order_id` branch doesn't even reference the webhook's amount at all,
   trusting `confirmOrderPayment()`'s own stored `order.total_kobo`
   instead — meaning the order-payment branch is actually *safer* on this
   specific axis than the wallet-topup branch, an asymmetry worth noting).
6. Look up `payment_transactions` by `provider_reference` (not by
   `provider_reference AND user_id` — the webhook is server-to-server, no
   `user_id` context from the request itself, so this is correct as-is,
   not a bug).
7. `if (!tx) return 'OK'` (unknown reference — correct, no-op).
8. `if (tx.status === 'success') return 'OK'` (the ENTIRE idempotency
   guard — read-then-branch, no atomicity).
9. Unconditional `UPDATE payment_transactions SET status = 'success' ...
   WHERE id = ?` — **no `WHERE status != 'success'` clause**, meaning two
   concurrent invocations of steps 8-11 can both pass step 8's check
   before either commits step 9's write.
10. Route to `confirmOrderPayment()` (has its own, separately-race-prone
    idempotency guard — see §E) or `creditWallet()` (has the wallet-level
    race from §A) depending on `tx.order_id`.

**Confirmed via Paystack's own documented behavior (general provider
knowledge, not verified against a live account in this session):**
Paystack retries webhook delivery on non-2xx response or timeout — making
duplicate delivery a realistic trigger for this exact race, not a
theoretical one.

## E. Order Payment Flow

**File:** `src/lib/orders.ts::confirmOrderPayment()` (lines 136-192, full
read this session and Phase 1).

```
const order = SELECT * FROM orders WHERE id = ?
if (order.payment_status !== 'unpaid') return   // <-- read-then-branch, no CAS
... compute stock updates ...
await db.batch([ UPDATE orders SET status='processing', payment_status='escrow_held', ... , ...stockUpdates ])
try { confirmCommissionsForOrderIfAttributed(...) } catch { swallow }
try { createShipmentsForPaidOrder(...) } catch { swallow }
```

Same TOCTOU shape as the pre-fix `payForBooking()`: the `SELECT` and the
`batch()` write are two separate round-trips with no atomic claim between
them. Two concurrent callers (e.g. a webhook retry landing at the same
instant as the client-side `topup/verify`-equivalent `/orders/:id/pay`
call, or two duplicate webhook deliveries both reaching this function)
can both read `payment_status === 'unpaid'`, both proceed past the guard,
and both execute the stock-decrement batch — double-decrementing stock
and (via `payOrderFromWallet`'s caller) potentially double-debiting the
wallet if the race originates from that path, or double-triggering
shipment creation / affiliate commission attribution.

**Callers, confirmed via grep:**
- `payOrderFromWallet()` (same file) — `debitWallet()` THEN
  `confirmOrderPayment()`. Note the ORDER here: wallet is debited BEFORE
  the order-payment claim, which is the reverse of `payForBooking()`'s
  fixed pattern (claim first, debit second). This is an important
  divergence to fix carefully in Unit 4 — simply copying
  `payForBooking()`'s literal code would change `payOrderFromWallet()`'s
  debit-then-confirm order into confirm-then-debit, which changes failure
  semantics (what happens to stock if the debit then fails) and must be
  reasoned through explicitly, not copy-pasted.
- `src/routes/api-orders.ts:286` — the Paystack client-verify callback
  path, calls `confirmOrderPayment(c.env.DB, tx.order_id, 'paystack', body.reference)`
  directly (this route's own `verifyPaystackTransaction()` call happens
  first, so this is the "immediate UX feedback" path the webhook's own doc
  comment refers to).
- `src/routes/api-webhooks.ts:41` — the authoritative webhook path (§D).

**Three independent call paths can all reach `confirmOrderPayment()` for
the same order** (wallet-pay, client-verify-callback, webhook) — the
read-then-branch guard is the ONLY thing preventing double-processing
across all three, and it is not atomic against any of them running
concurrently with each other.

## F. Refund Flow

**File:** `src/lib/refunds.ts::createAndExecuteRefund()` (lines 80-143,
full read this session and Phase 1).

```
capturedKobo = (item.final_price_kobo ?? item.line_total_kobo) | order.total_kobo
alreadyRefunded = SELECT SUM(amount_kobo) FROM refunds WHERE ... AND status='completed'
remaining = capturedKobo - alreadyRefunded
if (input.amountKobo > remaining) throw RefundError
INSERT INTO refunds (..., status='pending', ...)  -- refundId assigned here
newBalanceKobo = await creditWallet(...)            -- the actual money movement
UPDATE refunds SET status='completed', wallet_ledger_id=?, completed_at=... WHERE id=refundId
```

**Schema:** `migrations/0040_marketplace_engine_v2_1.sql:60-79`.
`refunds.status` DOES have a DB-level `CHECK (status IN ('pending',
'completed', 'rejected'))` — stronger than `payment_transactions.status`'s
convention-only vocabulary (§C).

**The race:** `alreadyRefunded` is computed by summing existing
`status='completed'` rows BEFORE the new refund's own row is inserted (as
`'pending'`, not yet counted in that SUM). Two concurrent
`createAndExecuteRefund()` calls against the same `order_id`/`order_item_id`
can both compute the same `alreadyRefunded`, both pass the `remaining`
check independently, and both proceed to insert+credit — together
exceeding `capturedKobo`. This is a genuine over-refund race, distinct
from (but same root cause as) G-1/G-2/G-3: **a read used to authorize a
write is not re-validated atomically at write time.**

Note: `creditWallet()` itself will be hardened in Unit 2, but that fixes
wallet-*balance* correctness, not refund-*amount* correctness — these are
two independent invariants (a refund could be wallet-balance-safe but
still exceed the order's captured amount if two refund requests race each
other before either wallet call happens). Unit 5 must add its own
CAS/atomic-claim layer at the `refunds` table level, not rely on Unit 2's
fix to cover this.

`resolveDispute()` (same file, line 198) already uses the correct pattern
for reference: `UPDATE disputes SET status = ? ... WHERE id = ? AND status
IN ('open', 'investigating')`, checking `rows_written`. **This is a
working, in-repo example of the exact CAS shape needed for refunds** — it
was apparently applied to disputes but not to the refund-amount check
itself, an inconsistency worth noting for Unit 5.

## G. Existing Idempotency Mechanisms

Summarized findings, consolidated from §A-F:

| Path | Mechanism | Atomic? |
|---|---|---|
| `payForBooking()` (booking) | CAS claim, `UPDATE ... WHERE payment_status='unpaid'`, checks `rows_written` | ✅ YES (Invariant 9, proven) |
| `resolveDispute()` | CAS claim, `UPDATE ... WHERE status IN (...)`, checks `rows_written` | ✅ YES (existing, unrelated to this phase) |
| `confirmOrderPayment()` | Read-then-branch (`if status !== 'unpaid' return`) | ❌ NO |
| Paystack webhook | Read-then-branch (`if status === 'success' return`) | ❌ NO |
| `creditWallet`/`debitWallet` | Read-then-write balance, no claim at all | ❌ NO |
| `createAndExecuteRefund` | Read-SUM-then-check, no claim at all | ❌ NO |
| `settleVariableWeightItem` (order-settlement.ts, out of this phase's scope) | Read-then-branch (`if settlement_status !== 'none' return {already_settled}`) | ❌ NO (not in scope for Units 2-5, flagged for future awareness only) |

**No repository-wide idempotency-key mechanism exists** — every guard is
a bespoke status-column check, confirmed via `grep -rn "idempotency" src/
migrations/` returning only comments/doc-references, zero implementing
column or table.

## H. Existing Unique Constraints Relevant to This Phase

- `wallet_ledger`: none beyond `PRIMARY KEY(id)`.
- `wallet_accounts`: `PRIMARY KEY(user_id)` — this IS usable as a natural
  single-row-per-user lock target for a CAS update.
- `payment_transactions`: none on `provider_reference` (confirmed gap,
  §C) — **Unit 3 should add `CREATE UNIQUE INDEX IF NOT EXISTS
  idx_payment_tx_reference_unique ON payment_transactions(provider_reference)`**
  as part of hardening (additive, `IF NOT EXISTS`, non-destructive, matches
  the repo's own migration-safety conventions used throughout 0037-0043).
- `orders`: `UNIQUE(order_number)` only — `payment_status`/`id` combo has
  no constraint, matching `bookings`' pre-fix state exactly.
- `refunds`: no unique constraint on `(order_id, order_item_id)` — by
  design, multiple partial refunds against the same item are legal.

## I. Existing CAS/Atomic-Update Patterns to Reuse

The one proven, in-repo template is `booking-lifecycle.ts::transitionBooking()`
and `booking-payments.ts::payForBooking()`'s claim step:

```typescript
const claimResult = await db
  .prepare(`UPDATE <table> SET <new-state-columns> WHERE id = ? AND <old-state-column> = <expected-old-value>`)
  .bind(...)
  .run()
if ((claimResult.meta.rows_written ?? 0) === 0) {
  // lost the race — re-read fresh state, reject with an accurate error, NEVER fabricate success
}
```

This pattern generalizes cleanly to enum-state columns
(`payment_status`, `payment_transactions.status`) but needs adaptation
for `wallet_accounts.cached_balance_kobo`, which is a *numeric* value, not
an enum. The natural D1/SQLite-compatible adaptation (confirmed the local
D1 engine supports it — see §J) is a **value-based CAS**:

```sql
UPDATE wallet_accounts
SET cached_balance_kobo = cached_balance_kobo + ?   -- or - ? for debit
WHERE user_id = ?
  AND cached_balance_kobo >= ?    -- for debit only: the pre-read balance floor, prevents negative
```

checking `rows_written === 1` to confirm the write actually happened
against the balance the caller expected, OR — the simpler and more
robust option not requiring a pre-read at all — letting SQLite compute
`cached_balance_kobo +/- amountKobo` directly in the `SET` clause (an
atomic, single-statement read-modify-write with no separate SELECT
needed beforehand), with a `WHERE cached_balance_kobo >= ?` guard on
debits only. This removes the race entirely rather than narrowing it,
and is the recommended direction for Unit 2 (final design decision
deferred to that unit itself, per this unit's "do not implement yet"
mandate — but the two viable options are recorded here so Unit 2 doesn't
have to re-derive them from scratch).

## J. Database Transaction Limitations (Local D1 / SQLite via Wrangler)

Confirmed by direct experiment this session (`npx wrangler d1 execute
naijadeals-production --local --json --command="..."`, wrangler 4.126.0,
Node v22.23.2):

- `db.batch()` executes multiple prepared statements atomically (already
  used throughout the codebase, confirmed working).
- **`UPDATE ... RETURNING <col>` is supported** by the local D1/SQLite
  engine (verified live: an `UPDATE __rtest SET v = v + 5 WHERE id = 1
  RETURNING v` returned `{"v": 15}` correctly). This is useful but not
  strictly required for the CAS pattern already proven (`rows_written`
  from `.run()`'s `.meta` is sufficient and is the existing convention —
  `RETURNING` is noted here as an available option, not a mandate to
  switch patterns).
- D1 does not support full interactive multi-statement transactions the
  way Postgres does (already documented in `wallet.ts`'s own header
  comment, re-confirmed, not contradicted by anything found this session)
  — `db.batch()` remains the correct atomicity primitive for
  multi-statement writes; single-statement atomic UPDATEs (the CAS
  pattern) remain the correct primitive for check-then-write races.

## K. Existing Test Infrastructure

- `tests/booking-engine/` — 9 files, Node's built-in `node:test` +
  `node:assert/strict`, zero new npm dependencies. Helpers:
  `helpers/client.mjs` (cookie-jar `ApiClient`, `registerUser`,
  `creditWalletDirect` — **already directly writes to `wallet_ledger`/
  `wallet_accounts` for test fixture setup, bypassing `creditWallet()`
  entirely by design**, since no public "top up" test endpoint exists;
  this is the exact same pattern Unit 2's new `tests/payment-engine/`
  suite should reuse for fixture setup, not a competing convention to
  invent fresh), `helpers/d1.mjs` (`execD1`/`queryD1`/`queryOneD1`, shells
  out to `npx wrangler d1 execute --local --json`).
- No `tests/payment-engine/` directory exists yet — confirmed via `ls
  tests/`, only `booking-engine` present. Unit 2 will create it,
  reusing `helpers/client.mjs` and `helpers/d1.mjs` as-is (copy or
  reference — decision deferred to Unit 2) rather than duplicating their
  logic.
- `package.json` has no `"test"` script currently — booking-engine tests
  are run directly via `node --test tests/booking-engine/*.test.mjs`
  (confirmed from the prior session's own run history, not re-executed in
  this read-only unit). The new `tests/payment-engine/` suite should be
  runnable the same way.
- Node version in this sandbox: `v22.23.2` — supports `node:test` natively
  with no flags.

---

## Summary of What Units 2-5 Must Each Solve

| Unit | Target | Race | Fix shape |
|---|---|---|---|
| 2 | `wallet.ts` credit/debitWallet | Lost-update on `cached_balance_kobo` (§A) | Atomic arithmetic UPDATE (`SET x = x +/- ?`) with a `WHERE balance >= ?` floor on debit; ledger insert stays in the same `db.batch()` |
| 3 | `api-webhooks.ts` Paystack handler | Non-atomic status check-then-write (§D) + untrusted amount (§D) | CAS claim on `payment_transactions.status`, `WHERE status != 'success'`; add missing UNIQUE index on `provider_reference` (§H); cross-check `event.data.amount` against the stored `payment_transactions.amount_kobo` before any credit/confirm |
| 4 | `orders.ts::confirmOrderPayment` | Non-atomic status check-then-write (§E), 3 independent callers | CAS claim on `orders.payment_status`, `WHERE payment_status = 'unpaid'`; reconcile `payOrderFromWallet`'s debit-before-confirm ordering explicitly (not a blind copy of `payForBooking`'s claim-before-debit order) |
| 5 | `refunds.ts::createAndExecuteRefund` | Read-SUM-then-check race on refundable remainder (§F) | Atomic claim mechanism at the refund-amount level — likely a guarded INSERT + a re-verification pattern, or a running-total column with a CAS update, decided in Unit 5 itself |

No implementation was performed in this unit. Proceeding per protocol:
commit this document only, push, fetch, verify 3-way SHA match, confirm
working tree clean, then STOP for checkpoint before Unit 2 begins.
