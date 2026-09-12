# Engine 7 Phase 2 — Unit 6: `PAYOUT_ENCRYPTION_KEY` Status Review

**Date:** 2026-09-12
**SHA at time of this review (start = end, no code changed):** `374b5856d0be3e16231f9d802535d11a5ca6363b`
**Branch:** `main`
**Working tree at start:** CLEAN

**Method:** Full-repository `grep` for every occurrence of `PAYOUT_ENCRYPTION_KEY`
and every payout-related table/type/route name, `git log` history search
(including `git log -S` and `--diff-filter=D`) to determine whether an
implementation ever existed and was removed, and a read of the migration
0009 commit that introduced the binding. **No implementation code was
written or modified. This is a documentation-only unit, per the Master
Continuous Execution Protocol's explicit instruction not to build any
payout functionality in this unit.**

---

## Finding: `PAYOUT_ENCRYPTION_KEY` is **RESERVED / NEVER-IMPLEMENTED** — not active, not legacy.

The three-way classification the protocol asked for (active / unused /
legacy-or-reserved) resolves cleanly to the third bucket, with one
important precision: it is not "legacy" (legacy implies something existed
and was later abandoned) — it is **reserved-but-never-built**. The binding
was declared as forward-looking scaffolding for a feature that was planned
in the same migration but whose application-code half was never written.

### Evidence

1. **Declared once, in the `Bindings` type, and nowhere else:**
   ```typescript
   // src/types.ts
   export type Bindings = {
     DB: D1Database
     SELLER_UPLOADS: R2Bucket
     PAYOUT_ENCRYPTION_KEY: string
   }
   ```
   A repo-wide `grep -rn "PAYOUT_ENCRYPTION_KEY" src/` returns exactly ONE
   match — this declaration. There is no second occurrence anywhere in
   `src/`.

2. **Never actually read from `env` anywhere:** `grep -rn
   "env.PAYOUT_ENCRYPTION_KEY\|c.env.PAYOUT_ENCRYPTION_KEY" src/` returns
   zero matches. No route handler, no lib function, no middleware ever
   accesses this binding's value. A TypeScript field can be declared in a
   type without ever being read, and that is exactly the case here — this
   is provably dead surface area, not a wired-up secret with a bug hiding
   its usage.

3. **No corresponding entry in `wrangler.jsonc`:** the file has no `vars`
   section and no `PAYOUT_ENCRYPTION_KEY` entry of any kind (checked via
   direct grep of the full file, reproduced below). In a real Cloudflare
   Pages deployment, this binding would need `wrangler secret put
   PAYOUT_ENCRYPTION_KEY` to exist at all — that step has evidently never
   been performed, and no deployment tooling in this repo references it
   either.
   ```jsonc
   // wrangler.jsonc — full file, for the record
   {
     "$schema": "node_modules/wrangler/config-schema.json",
     "name": "naijadeals",
     "compatibility_date": "2026-08-25",
     "pages_build_output_dir": "./dist",
     "compatibility_flags": ["nodejs_compat"],
     "d1_databases": [ { "binding": "DB", "database_name": "naijadeals-production", "database_id": "00000000-0000-0000-0000-000000000000" } ],
     "r2_buckets": [ { "binding": "SELLER_UPLOADS", "bucket_name": "naijadeals-seller-uploads" } ]
   }
   ```

4. **No `.dev.vars` entry:** the local dev secrets file
   (`.dev.vars`, gitignored) contains only `PAYSTACK_SECRET_KEY` (added in
   Unit 3 for the webhook test harness). No `PAYOUT_ENCRYPTION_KEY` line
   exists there either, so even local development has never exercised
   this binding.

5. **`src/lib/payouts.ts` — referenced in comments, never created:**
   ```bash
   $ find . -iname "*payout*" -not -path "./node_modules/*" -not -path "./.git/*"
   (no output)
   ```
   No file of that name, or any payout-specific lib file, exists anywhere
   in the repository. Yet `src/types.ts`'s own doc comment for
   `SellerPayoutAccountRow` explicitly says *"See src/lib/payouts.ts"* — a
   forward reference to a module that was never actually written.

6. **The schema it was meant to encrypt exists; the code that would use
   the key does not.** Migration `0009_seller_portal.sql` created:
   - `seller_payout_accounts` (has an `account_number_encrypted TEXT`
     column, with an explicit design-intent comment: *"AES-256-GCM, Web
     Crypto, key from the PAYOUT_ENCRYPTION_KEY secret — never the
     plugin's PAYSTACK_SECRET_KEY, a separate secret with a separate blast
     radius"*)
   - `seller_payout_account_audit` (an audit trail table for changes to
     the above)

   Both tables **exist in the live local D1 schema** (confirmed via
   `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE
   '%payout%'` → `seller_payout_accounts`, `seller_payout_account_audit`,
   `affiliate_payouts`), but a repo-wide grep for
   `SellerPayoutAccountRow|SellerPayoutAccountPublic|seller_payout_accounts|seller_payout_account_audit`
   across `src/routes/` and `src/lib/` returns **zero matches** — nothing
   in the application ever reads or writes these two tables. They are
   pure, inert schema with no code path touching them.

7. **`git log` confirms this was never built, not built-then-removed:**
   - `git log --oneline --all -- src/lib/payouts.ts` → empty (the file was
     never created, ever, in any commit).
   - `git log --oneline --all --diff-filter=D -- "*payout*"` → empty (no
     payout-related file has ever been deleted from this repository).
   - `git log --oneline -S "PAYOUT_ENCRYPTION_KEY" -- src/types.ts` →
     exactly one hit: commit `6ce15f6` ("feat(seller): Migration 0009 —
     Seller Portal foundation schema"), the SAME commit that created the
     `seller_payout_accounts`/`seller_payout_account_audit` tables. The
     binding and the schema were introduced together, as forward-looking
     scaffolding for a feature phase that was never subsequently
     implemented.

### What IS implemented and live, for contrast (so this isn't confused with the same word "payout")

- **`affiliate_payouts`** (migration `0018_affiliate_account_state.sql`) —
  this table IS actively used: `src/lib/affiliate.ts`'s
  `requestAffiliatePayout()`/`getAffiliatePayouts()`, wired to real routes
  `GET /api/affiliate/me/payouts` and `POST /api/affiliate/me/payouts` in
  `src/routes/api-affiliate.ts`. This is a **payout REQUEST tracking
  table only** — `requestAffiliatePayout()`'s own doc comment is explicit:
  *"the actual bank-transfer execution... is an admin-reviewed action, not
  automatic... This function only ever creates the REQUEST — it never
  marks a payout 'paid' itself."* No money ever actually leaves the
  platform through this code path; it only records that an affiliate
  asked to withdraw and debits their internal ledger balance. No bank
  transfer, no Paystack/Flutterwave transfer API call, no encryption of
  any bank account number occurs anywhere in this flow — there is no bank
  account number to encrypt in the affiliate flow at all (affiliates are
  paid out by an entirely separate, still-manual admin process outside
  this codebase's scope).
- This affiliate payout REQUEST-tracking table is unrelated to
  `PAYOUT_ENCRYPTION_KEY` — it never touches that binding, and its
  existence does not change the finding above about `seller_payout_accounts`.

## Conclusion

`PAYOUT_ENCRYPTION_KEY` is **reserved, unused, and never wired to any
runtime code path**. It was declared once, in the same migration that
scaffolded the (also-unused) `seller_payout_accounts` /
`seller_payout_account_audit` schema, as forward-looking infrastructure
for a "Seller Payout Accounts" feature that has not yet been built. There
is:
- no `src/lib/payouts.ts` (never created),
- no route that reads or writes `seller_payout_accounts`,
- no code that reads `env.PAYOUT_ENCRYPTION_KEY`,
- no `wrangler.jsonc` `vars` entry or `.dev.vars` entry for it,
- and no evidence it was ever exercised even once, in dev or otherwise.

**Per the Master Continuous Execution Protocol's explicit instruction for
this unit: no payout functionality, encryption implementation, UI, or
Control Center integration has been built or modified in this pass.**
This document is the complete deliverable for Unit 6 — a factual status
record, not a design proposal and not an implementation.

## Recommendation (informational only, not actioned in this unit)

If/when a future engine phase is explicitly authorized to build seller
bank-account payouts, the correct sequence would be: (1) implement
`src/lib/payouts.ts` with the AES-256-GCM Web Crypto encrypt/decrypt pair
the migration 0009 comment already specifies, (2) wire
`env.PAYOUT_ENCRYPTION_KEY` through it, (3) provision the actual secret
via `wrangler secret put PAYOUT_ENCRYPTION_KEY` before any production
deploy, (4) build the seller-facing bank-account CRUD routes against the
already-existing `seller_payout_accounts`/`seller_payout_account_audit`
schema, and (5) apply this same phase's concurrency-hardening discipline
(atomic claims, no read-then-write races) to whatever payout-execution
logic is built on top. **None of this is in scope for the current Engine
7 Phase 2 run**, which is explicitly prohibited from building escrow,
seller/provider payouts, or the payout encryption subsystem.
