# NaijaDeals Permanent Engineering Rule: D1 Migrations Go Through the Deploy Pipeline's Migration Runner — With a Mandatory Reconciliation Check

**Status: ACTIVE — applies to every NaijaDeals workstream and every future
session, sandbox, or agent working on this repo.**

**Adopted:** 2026-09-19, after the Stage 2C release. This is a **re-adoption
with teeth** — the underlying rule was first written down during an earlier
cycle (see README.md "Deploy-pipeline lesson learned", commit `d0d6e34`) and
was violated during Stage 2C anyway, for a structural reason documented
below. The rule as originally written was a prohibition with no fallback
procedure. This version adds the fallback procedure, because "don't do X"
is not durable if there's no defined recovery when X happens anyway.

## What happened (Stage 2C, migration 0071)

1. Migration `0071_currency_address_foundation.sql` was submitted directly
   via `gsk hosted d1_execute` (not through `gsk hosted deploy`) so it could
   be approved, applied, and **verified against real production data**
   (backfill correctness, row counts, zero NULLs) as an isolated, reversible
   checkpoint *before* the Worker code was touched at all.
2. This succeeded — the DDL ran cleanly (8/8 statements, 61 rows affected),
   and was independently verified correct.
3. Minutes later, `gsk hosted deploy` was triggered. Its internal pipeline
   runs `wrangler d1 migrations apply` as part of every deploy, using its
   own bookkeeping table (`d1_migrations`) to decide what's pending. Because
   `d1_execute` had applied 0071's SQL directly (bypassing `wrangler d1
   migrations apply`), `d1_migrations` still showed 0070 as the latest
   applied migration — so the deploy pipeline tried to re-run 0071 and
   failed with `duplicate column name: currency: SQLITE_ERROR`.
4. The Worker code deploy itself still succeeded (asset upload and worker
   publish are independent of the migration step failing) — but the
   `d1_migrations` bookkeeping was left permanently out of sync with
   reality. **Every subsequent deploy would have repeated this exact
   failure indefinitely** until reconciled.
5. Caught and fixed same-session: manually inserted the missing bookkeeping
   row (`INSERT INTO d1_migrations (id, name, applied_at) VALUES (71,
   '0071_currency_address_foundation.sql', CURRENT_TIMESTAMP)`), then
   verified `SELECT * FROM d1_migrations WHERE id=71` returned the correct
   row before considering the release complete.

## Why the original rule wasn't enough

The original wording ("migrations are applied exclusively through the
deploy pipeline's own migration runner — never pre-applied manually") is
the *correct default*. But the `gsk hosted` tool's own approval-gate design
actively invites splitting DDL and deploy into two separately-confirmable
human checkpoints — which is a reasonable safety instinct under a
production-write approval workflow, not carelessness. A rule that forbids
a natural workflow pattern without acknowledging why people reach for it,
and without a defined recovery path for when it happens anyway, will get
violated again. This version fixes that.

## The rule (v2 — with the actual enforcement mechanism)

> **Default path:** Let migrations ride inside `gsk hosted deploy`'s own
> migration step. Do not pre-apply DDL via `d1_execute` as a matter of
> routine.
>
> **If a migration is pre-applied via `d1_execute` anyway** (e.g. to get an
> isolated, revertable-if-wrong checkpoint on production data before
> touching the Worker — a legitimate reason, not a mistake by itself), the
> following is **mandatory, not optional**, before the release can be
> considered done:
>
> 1. Immediately after the DDL succeeds, insert the matching row into
>    `d1_migrations` yourself:
>    ```sql
>    INSERT INTO d1_migrations (id, name, applied_at)
>    VALUES (<id>, '<filename>.sql', CURRENT_TIMESTAMP);
>    ```
>    Do this **before** running `gsk hosted deploy`, not after discovering
>    the collision. Waiting for the deploy to fail first is not the
>    intended workflow — reconcile bookkeeping proactively.
> 2. Verify the row landed: `SELECT * FROM d1_migrations WHERE id=<id>;`
> 3. Only then trigger `gsk hosted deploy`.
> 4. As part of every release closure checklist, confirm
>    `SELECT MAX(id) FROM d1_migrations` on production matches the highest
>    migration filename number present in `migrations/` — a mismatch here
>    means a future deploy will fail on its migration step, full stop,
>    regardless of whether the Worker code deploy itself looks fine in the
>    log.

## Standard workflow for a migration-bearing release

```
Write + preflight migration SQL against production schema/data (read-only)
   ↓
Decide: ride inside `gsk hosted deploy`'s migration step (default),
        OR pre-apply via d1_execute for an isolated checkpoint (exception)
   ↓
[If pre-applied via d1_execute]
   → immediately INSERT the d1_migrations bookkeeping row
   → verify it landed
   ↓
gsk hosted deploy
   ↓
If deploy log shows a migration-step failure anyway:
   → check `SELECT MAX(id) FROM d1_migrations` vs migrations/ directory
   → reconcile the missing row
   → do NOT re-run the same deploy blindly assuming it'll skip the
     already-applied DDL — confirm bookkeeping first
   ↓
Before declaring the release closed:
   → SELECT MAX(id) FROM d1_migrations  (production)
   → compare to highest numbered file in migrations/
   → must match
```

## Never

- Assume a deploy's "Deployment finished successfully" log line means the
  migration step also succeeded — check the migration-step log lines
  specifically; Worker publish and migration application are independent
  steps that can partially fail.
- Leave a `d1_migrations` bookkeeping mismatch "for next time" — it does
  not resolve itself and will fail every future deploy identically.
- Treat a pre-applied DDL checkpoint as "done" without immediately writing
  its bookkeeping row — the two are one atomic unit of work, not two
  optional steps.

## Checkpoint Log

| Date | Release | Migration | Pre-applied via d1_execute? | Bookkeeping reconciled? | Verified MAX(id) match? |
|---|---|---|---|---|---|
| 2026-09-19 | Stage 2C — currency + address foundation | `0071_currency_address_foundation.sql` | YES (approval-gated checkpoint before deploy) | YES (`id=71` inserted, verified) | YES |
