# NaijaDeals — Engines 1–8 GitHub Checkpoint / Remote Integrity Audit

**Status:** READ-ONLY AUDIT. No code modified, no branches merged/rebased/reset,
no force-push performed, nothing cherry-picked. Every claim below is backed by
a `git`/GitHub-API command executed during this session — commands and raw
outputs are summarized inline; nothing is inferred from memory or from prior
Genspark completion reports.

**Repository:** `https://github.com/naijadeals001-hash/naijadeals002`
**Audit performed:** 2026-09-12
**Audit method:** `git fetch --prune` (fresh remote state) → `git rev-parse` /
`git merge-base --is-ancestor` / `git ls-tree -r` on each branch tip → GitHub
REST API (`/commits/{sha}`, `/branches`, `/events`, `/repos`) using the
session's stored GitHub token → cross-account repo enumeration
(`/user/repos`) → global GitHub commit search for any SHA not found in this
account's repos.

---

## 0. Executive Answer (read this first)

**GitHub has THREE branches, and they are NOT the same codebase:**

| Branch | Tip SHA | Commits | Migrations | Engines present |
|---|---|---|---|---|
| `main` (default branch) | `1cdfdcbc976d2dbb1f9885a4576ba8cfc5ed58e1` | 43 | **12** | Engine 1 core marketplace ONLY. No Control Center, no Booking, no Logistics, no Provider Identity, no polymorphic Reviews, no Engine 8 audit. |
| `production-ready` (this session's working branch) | `fc1821774647e99e19496712171fbf2124444de3` | 57 | **43** | Engines 1–8 foundations, Booking Engine 2.0 hardening (invariants 1–6), Engine 8 Phase 1 audit. |
| `production-reconstruction` | `2420434389dad62a1a5ee1e2974b848080b88a34` | 14 | 43 (schema-reconstruction only) | Ancestor of `production-ready`; a completed intermediate step, not a separate line of work. |

**`main` is 14 commits behind `production-ready` and is missing every Engine
2–8 implementation entirely at the file level** — confirmed by direct
`git ls-tree` diff (94 files exist on `production-ready` that do not exist on
`main`; zero files exist on `main` that don't exist on `production-ready` —
`production-ready` is a strict superset). **All of this session's work
(Engine 8 audit, Booking invariants 1–6, the critical double-refund fix) is
real, pushed, and verifiable — but it is sitting on `production-ready`, not
on `main`, the repository's own default branch.**

This is the single most important finding of this audit: **if "the current
GitHub main branch" is read literally, almost none of Engines 2–8 are on it.**
If "GitHub" is read as "the repository, any branch," then Engines 1–6 (through
this session's Booking work) and the Engine 8 audit are all genuinely present,
pushed, and verified. The distinction matters and is not a technicality — a
default-branch checkout, a CI pipeline keyed to `main`, or a new collaborator
cloning the repo would see the 12-migration version, not the 43-migration one.

---

## 1. Branch Ancestry — Traced and Proven

```
git fetch origin --prune
git rev-parse origin/main origin/production-ready origin/production-reconstruction
git merge-base --is-ancestor <A> <B>   (run in both directions, all 3 pairs)
git merge-base <A> <B>                  (to find the actual fork point)
```

**Results:**

| Pair | A ancestor of B? | B ancestor of A? | Merge-base |
|---|---|---|---|
| `main` → `production-ready` | **NO** | YES (main IS an ancestor of production-ready) | `1cdfdcb` (= main's own tip) |
| `production-ready` → `production-reconstruction` | NO | **YES** (production-ready IS an ancestor of production-reconstruction... | — |

Correction for precision — re-stated directly from tool output, no rounding:

- `git merge-base --is-ancestor origin/main origin/production-ready` → **YES**. `main`'s tip (`1cdfdcb`) is fully contained in `production-ready`'s history.
- `git merge-base --is-ancestor origin/production-ready origin/main` → **NO**. `production-ready` is strictly ahead; none of its 14 extra commits ever reached `main`.
- `git log origin/production-ready..origin/main --oneline` → **0 commits** (confirms `main` has nothing `production-ready` lacks).
- `git log origin/main..origin/production-ready --oneline` → **14 commits** (the full list is in §3 below).
- `git merge-base --is-ancestor origin/production-reconstruction origin/production-ready` → **YES**. `production-reconstruction` is a real ancestor of `production-ready`, not a diverged fork — it is the exact commit (`2420434`) at which the 43-migration schema reconstruction landed, before Engines 3/4/5/8 work continued on top of it on `production-ready`.
- `git merge-base --is-ancestor origin/main origin/production-reconstruction` → **YES** (consistent — `production-reconstruction` also contains all of `main`).

**Conclusion:** This is a simple linear fork, not a tangled multi-branch
history. `main` stopped advancing at `1cdfdcb`. `production-reconstruction`
and `production-ready` are the same lineage, with `production-ready` being
14 commits further ahead. There is **no divergent/conflicting branch** —
nothing on `main` needs reconciling against `production-ready`; `main` is
simply stale, not different.

---

## 2. GitHub Repository & Branch Inventory (live API, not cached)

```
GET /repos/naijadeals001-hash/naijadeals002/branches   → main, production-ready, production-reconstruction (3, exactly)
GET /repos/naijadeals001-hash/naijadeals002/tags        → naijadeals-sop-checkpoint-2026-09-12, naijadeals-bootstrap-repair-complete-2026-09-12 (2)
GET /repos/naijadeals001-hash/naijadeals002/pulls?state=all → [] (0 PRs, open or closed, ever)
GET /repos/naijadeals001-hash/naijadeals002/events      → confirms push history (see §3)
```

No open PRs exist that might contain unmerged Engine work outside these 3
branches. No releases inspected beyond the 2 tags (both pre-date this
session's work and are unrelated to Engines 3–8).

---

## 3. Full Commit-Level Trace: the 14 commits on `production-ready` absent from `main`

`git log origin/main..origin/production-ready --oneline --reverse`, oldest
first, each independently re-verified present on GitHub via
`GET /commits/{sha}` (all returned HTTP 200):

| # | SHA | Message | Engine |
|---|---|---|---|
| 1 | `2420434` | feat(db): reconstruct migrations 0013-0036 from recovered production schema | Schema reconstruction (2,5,6,8 foundations) |
| 2 | `7eefa4e` | feat(affiliate): build real Affiliate program application layer | Affiliate (adjacent to Engine 7) |
| 3 | `3ca9329` | Identity & Account Engine 2.0: universal organization/RBAC foundation | **Engine 2** (Identity/Org/RBAC) |
| 4 | `bd8b0ea` | Marketplace Engine 2.0: vendor-org bridge, tiered pricing, inventory ledger... | **Engine 1** (2.0) |
| 5 | `173c2db` | Engine 3: Service Engine 2.0 foundation | **Engine 4** per this audit's numbering (spec calls it "Engine 3" in its own commit message — see §9 naming note) |
| 6 | `5066f72` | Complete Marketplace Engine 2.1: order lifecycle, refunds/disputes, settlement... | **Engine 1** (2.1) |
| 7 | `d6e378e` | Engine 4: Booking Engine 2.0 | **Engine 3** (Booking) |
| 8 | `f5ba574` | Engine 5: Logistics Engine 2.0 | **Engine 6** (Logistics/NaijaSend) |
| 9 | `769fca2` | Logistics Proof Gate: fix 3 real bugs found via live E2E testing | Engine 6 hardening |
| 10 | `6670298` | fix(booking): block client-controlled organizationId injection + unowned cancellationPolicyId theft | Engine 3 (Booking) security fix |
| 11 | `4f2cab8` | fix(booking): clean 400 on malformed hold requests + FK fix + regression harness (4/8) | Engine 3 |
| 12 | `f8a4ccb` | test(booking): concurrency invariant regression tests (5/8) | Engine 3 |
| 13 | `c963d27` | fix(booking): CRITICAL double-refund race fix + invariant 6/8 | Engine 3 (this session) |
| 14 | `fc18217` | docs(engine-8): Phase 1 Trust/Safety audit | **Engine 8** (this session) |

**Every one of these 14 commits is pushed and present on GitHub right now.**
None are stranded, none are orphaned, none required cherry-picking or
reimplementation to verify — they simply live on a branch other than `main`.

**Naming note (important, not cosmetic):** the commit messages themselves use
inconsistent engine numbering versus this audit's numbering request (e.g.
commit `173c2db` calls itself "Engine 3: Service Engine" while the audit
request's Engine 3 = Booking). This audit uses **the numbering given in the
user's own request** (Engine 3 = Booking, Engine 4 = Provider Identity, Engine
5 = Maps/GPS, Engine 6 = Logistics) throughout, and flags every place a commit
message's self-description differs, to avoid the exact kind of
"trust commit messages" error this audit was explicitly told not to make.

---

## 4. Known-Checkpoint SHA Verification — Full Results Table

Every SHA supplied in the request was checked three ways: (a) local git object
database (`git cat-file -e`), (b) direct GitHub commit API
(`GET /commits/{sha}`), (c) ancestry against both `main` and
`production-ready` where resolvable. Unresolved short SHAs were additionally
checked against (d) all 14 other repositories on this GitHub account and (e) a
global cross-GitHub commit-hash search.

| Checkpoint SHA | Local DB | GitHub API | Ancestor of `main`? | Ancestor of `production-ready`? | Classification |
|---|---|---|---|---|---|
| `a9ba93e` | ✅ found (`a9ba93eddefc...`) | ✅ 200 | **YES** | YES | **FULLY PUSHED** |
| `ca40f93` | ✅ found (`ca40f936e353...`) | ✅ 200 | **YES** | YES | **FULLY PUSHED** |
| `eb4642e` | ❌ not found | ❌ 422 "No commit found" | — | — | **STRANDED / NOT FOUND** (see §5) |
| `8587631` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `9385ed3` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `ceba23f` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `ab455c9` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `0914834` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `97cc6fd` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `6d07595` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `93191ce` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `8c43e0e` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `533511b` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `6cbe37f` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `b5813f2` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `0957147` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `35df994` | ❌ not found | ❌ 422 | — | — | **STRANDED / NOT FOUND** |
| `73ea663` | ✅ found (`73ea663168dd...`) | ✅ 200 | **YES** | YES | **FULLY PUSHED** |
| `f5ba574` | ✅ found (`f5ba5744e706...`) | ✅ 200 | **NO** | YES | **PUSHED BUT NOT ON MAIN** |
| `769fca24752c34e5e7d11aa5d9000b1ef0412351` (full SHA) | ✅ found | ✅ 200 | **NO** | YES | **PUSHED BUT NOT ON MAIN** |
| `f8a4ccbca242cf54a9654e8c7264821d15753150` (full SHA) | ✅ found | ✅ 200 | **NO** | YES | **PUSHED BUT NOT ON MAIN** |
| `fc1821774647e99e19496712171fbf2124444de3` (full SHA) | ✅ found | ✅ 200 | **NO** | YES | **PUSHED BUT NOT ON MAIN** — this session's audit doc |

### §5 — On the 15 unresolved short SHAs (`eb4642e` … `35df994`)

This audit takes the request's own explicit warning seriously: *"Some older
SHAs may come from previous Genspark sandboxes. Therefore, their existence
must be independently verified on GitHub."* Independent verification was
performed as follows, and **all 15 came back negative on every check**:

1. **Local git object database** — `git cat-file -e <sha>` fails for all 15 (this sandbox's `.git` has never held these objects).
2. **Direct GitHub commit lookup** on `naijadeals001-hash/naijadeals002` — `GET /commits/{sha}` returns HTTP 422 `"No commit found for SHA"` for all 15 (contrast: the same call for `a9ba93e` returns HTTP 200 with a full commit object, proving the endpoint and token both work correctly — this is not an auth or API failure).
3. **All 14 other repositories on this GitHub account** were enumerated (`GET /user/repos`) and each one checked individually for all 15 SHAs — **zero matches** in any of: `new-naijadeals`, `naijadeals` (no numeral), `naijadeals-app`, `naijadeals-designs`, `naijadeals-mobile`, `naijadeals-infra`, `naijadeals-n8n`, `naijadeals-docs`, `naijadeals-api`, `naijadeals-api-specs`, `Milestone-1`, `Vinyl-Project-Phases-and-Structure`, and the two unrelated WholeWard Health repos.
4. **Local `git fsck --full --unreachable --dangling`** — found only 2 dangling commits (`5f50bd0`, `9286cc2`), both self-evidently a `git stash`-style WIP/index snapshot from earlier in *this* session's own history (commit messages literally say "WIP on production-ready: 2420434..." and "index on production-ready: 2420434..."), **not** any of the 15 requested SHAs.
5. **Global cross-GitHub commit search** (`GET /search/commits?q=hash:<sha>`) returns nonzero `total_count` for every one of the 15 — but this is a **coincidence of short-SHA collision across GitHub's entire public corpus** (7-character hex prefixes collide constantly across millions of repositories), not evidence these specific commits exist in any NaijaDeals-related repo. This search result is reported here only for completeness/transparency about what was checked, and is explicitly **not** treated as positive evidence, per the audit's own "do not fabricate GitHub status" instruction — cross-referencing the returned repos confirms none belong to `naijadeals001-hash` or reference this codebase.

**Classification for all 15: STRANDED / NOT FOUND.** Per this audit's own
required classification set, "STRANDED" most precisely describes their
status if they are real orphaned commits from a lost sandbox (consistent with
the documented "total sandbox loss" incident in
`docs/ENGINEERING-SOP-BACKUP-RULE.md`, referenced from `main`'s own recovery
report — see §7 below); "NOT FOUND" is equally accurate if they simply never
existed under these exact short forms. This audit cannot distinguish between
those two sub-cases with the tools available (a deleted/orphaned commit that
was garbage-collected on GitHub's side leaves no forensic trace retrievable
via the REST API), and states that limitation explicitly rather than guessing.

---

## 6. Remote File / Migration / Service / API / Test Verification (not commit-message trust)

Per the audit's explicit instruction to verify actual files, not commit
messages, every claim below is from `git ls-tree -r <branch> --name-only` or
`git show <branch>:<path>` against the live fetched remote refs.

### 6a. Migration files — direct count and diff

```
git ls-tree origin/main:migrations/ --name-only        → 12 files (0001–0012)
git ls-tree origin/production-ready:migrations/ --name-only → 43 files (0001–0043)
```
Full diff (`diff <(ls-tree main) <(ls-tree production-ready)`) confirms **zero
files removed, 31 files added** going from `main` to `production-ready` — a
strict superset, not a rewrite.

### 6b. `src/lib/` service files — direct listing

```
main:               addresses.ts, auth.ts, cart.ts, catalog.ts, coupons.ts,
                     ecosystem-verticals.ts, ecosystem-waitlist.ts, guest.ts,
                     hero-campaigns.ts, homepage-feed.ts, money.ts, orders.ts,
                     paystack.ts, seller.ts, wallet.ts, wishlist.ts
                     (16 files)

production-ready:   all 16 of the above, PLUS: account.ts, affiliate.ts,
                     attributes.ts, booking-availability.ts,
                     booking-cancellation.ts, booking-holds.ts,
                     booking-lifecycle.ts, booking-payments.ts, bookings.ts,
                     buybox.ts, collections-admin.ts, collections.ts,
                     country.ts, inventory.ts, logistics-delivery.ts,
                     logistics-dispatch.ts, logistics-drivers.ts,
                     logistics-naijashop-bridge.ts, logistics-pricing.ts,
                     logistics-shipments.ts, logistics-tracking.ts,
                     moderation.ts, order-lifecycle.ts, order-settlement.ts,
                     organizations.ts, pricing.ts, providers.ts, rbac.ts,
                     refunds.ts, seller-products.ts, service-orders.ts,
                     service-requests.ts, services.ts, stores.ts
                     (+34 files, 50 total)
```
**main has zero booking, zero logistics, zero organizations/RBAC, zero
provider, zero refunds/disputes, zero services library code of any kind.**
This is not a subtle gap — these are the literal implementation files for
Engines 2, 3, 4, and 6.

### 6c. `src/routes/` API files

```
main:               api-addresses.ts, api-auth.ts, api-cart.ts, api-catalog.ts,
                     api-ecosystem.ts, api-i18n.ts, api-orders.ts, api-wallet.ts,
                     api-webhooks.ts, api-wishlist.ts, placeholder.ts, version.ts
                     (12 files)

production-ready:   all 12 above, PLUS: api-account.ts, api-admin.ts,
                     api-affiliate.ts, api-bookings.ts, api-logistics.ts,
                     api-organizations.ts, api-provider.ts, api-seller.ts,
                     api-service-requests.ts, api-services.ts
                     (+10 files, 22 total)
```

### 6d. Tests directory

```
main:               does not exist (git ls-tree origin/main:tests/ → error, no such path)
production-ready:   tests/booking-engine/{01-06}.test.mjs + helpers/{client,d1}.mjs
```
`main` has **zero automated tests of any kind, for any engine.**
`production-ready` has exactly the Booking Engine harness built this session
— no Engine 1/2/4/5/6/7/8 tests exist on either branch.

### 6e. Documentation

```
main docs/:              ENGINEERING-SOP-BACKUP-RULE.md, NAIJADEALS-BASELINE-AUDIT.md,
                          NAIJADEALS-LIVE-PRODUCTION-AUDIT.md,
                          NAIJADEALS-PRODUCTION-RECOVERY-INDEX.md,
                          NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md,
                          NAIJADEALS_MASTER_ARCHITECTURE.md,
                          NAIJASEND-FOUNDATION-READINESS-REPORT.md,
                          NAIJASEND-LIFECYCLE-A-DESIGN.md
                          (8 files)

production-ready docs/:  all 8 above, PLUS: ENGINE-8-TRUST-SAFETY-AUDIT.md,
                          NAIJADEALS-PRODUCTION-RECONSTRUCTION-PLAN.md,
                          NAIJADEALS-PRODUCTION-SCHEMA-MAP.md
                          (11 files)
```

**Directly relevant self-disclosure found on `main` itself:** `main`'s own
`docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md` (read in full this session)
already documents — independently of anything reported to the user in a
previous chat session — that **production (`naijadeals.com`) itself is
running a 36-migration build with a `git_sha` (`99b1664df552ce1cd707330e...`)
that has never existed in this repository's git history on any branch, ever**,
and that this is attributed to a documented pattern of prior sandbox-loss
incidents where `gsk hosted deploy` published code directly from a sandbox
working tree that was never pushed to GitHub at all. **This is independent,
pre-existing, GitHub-native evidence — written by an earlier session, stored
in the repo itself — that corroborates this audit's own finding that
GitHub does not contain 100% of everything that has ever been built or
deployed for this project.** This audit did not need to take that report's
word for it: `main`'s 12-migration `migrations/` folder and empty `src/lib/`
booking/logistics/provider files are directly, independently observable right
now via `git ls-tree`, exactly as that report also found.

---

## 7. Superseded / Reimplemented Work

No case of true "supersession" (i.e., a properly-functioning old
implementation later replaced by a different one still present on the
default branch) was found. What exists instead is **replacement of an
entirely separate, never-recovered codebase** (production's own
`99b1664...` build, deployed but never pushed) **by a from-scratch
reconstruction** (`2420434` → the 43-migration schema, followed by
Engines 1–6/8 rebuilt on `production-ready` this session and prior sessions).
This is documented in `main`'s own `NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md`
and `NAIJADEALS-PRODUCTION-RECOVERY-INDEX.md` as an explicit, deliberate
"schema-first, route/API-first reconstruction" — not an accidental
duplication this audit is flagging as a problem. No engine implementation in
this repository was found to have two live, conflicting versions on two
different branches; `production-ready`'s versions of every engine are the
only versions that exist anywhere in code form.

---

## 8. Stranded Work — Full Accounting

| Item | Status |
|---|---|
| The 15 short SHAs (`eb4642e`…`35df994`) | **STRANDED / NOT FOUND** — see §5. Not recoverable via any read-only tool available to this audit. |
| Production's live `99b1664...` build (36 migrations, 106 D1 tables) | **STRANDED**, documented independently on `main` itself. Source code was never in this repo's git history on any branch (re-confirmed this session: `git cat-file -e 99b1664` fails locally; the SHA does not appear in any branch). Only its *data-layer fingerprint* (the D1 schema, captured via `gsk hosted d1_schema`) was recoverable — this is exactly what became `production-ready`'s reconstructed migrations 0013-0036, per that migration file's own header comment. |
| 2 local dangling commits (`5f50bd0`, `9286cc2`) | Not "stranded work" — confirmed to be `git stash`-equivalent WIP/index snapshots from earlier in this same session, self-labeled as such in their own commit messages. No unique content of value; not pushed to GitHub, not expected to be. |

---

## 9. Per-Engine Status (evidence-based, using the request's own Engine 1–8 numbering)

| Engine | Scope | On `main`? | On `production-ready`? | Evidence | Status |
|---|---|---|---|---|---|
| **Engine 1** — Marketplace/Catalog/Cart/Orders/Seller/Wallet | Core commerce | Partial (Phase-1 MVP only: catalog, cart, checkout, wallet, orders — 12 migrations) | **Full** — Marketplace 2.0 (`bd8b0ea`: vendor-org bridge, tiered pricing, inventory ledger, buy-box, collections) + 2.1 (`5066f72`: order lifecycle state machine, refunds/disputes, variable-weight settlement, moderation) | `src/lib/{buybox,collections,collections-admin,inventory,order-lifecycle,order-settlement,pricing,refunds,seller-products,stores}.ts` exist only on `production-ready`; migrations 0038/0040 exist only there | **PARTIALLY PUSHED** (foundational MVP is on main; the 2.0/2.1 depth is PUSHED BUT NOT ON MAIN) |
| **Engine 2** — Control Center / Integration Hub | Admin ops, audit, integrations | **Absent** | Schema present (`0013_control_center_foundation.sql`: `cc_audit_logs`, `cc_domain_events`, `cc_alerts`; `0023_integration_hub.sql`: `cc_integrations`, `cc_integration_providers`, `cc_integration_country_overrides`), Identity/RBAC application code present (`3ca9329`: `src/lib/organizations.ts`, `src/lib/rbac.ts`, migration 0037), admin API present (`src/routes/api-admin.ts` — moderation/disputes/collections, gated by `requirePlatformRole`) | No dedicated Integration Hub application code found beyond the schema (confirmed via grep — only the 2 migration files reference it) | **PARTIALLY PUSHED** — RBAC/audit-log/admin-API layer is genuinely built and pushed to `production-ready`; Integration Hub itself is schema-only, no service code |
| **Engine 3** — Booking Engine | Availability/holds/lifecycle/cancellation | **Absent** | `d6e378e` (foundation) + 3 security/bug-fix commits + this session's invariant 1–6 regression suite (`6670298`,`4f2cab8`,`f8a4ccb`,`c963d27`) — `src/lib/booking-{availability,cancellation,holds,lifecycle,payments}.ts`, `src/routes/api-bookings.ts`, migrations 0024/0041/0043, `tests/booking-engine/{01-06}.test.mjs` | Full file-level, migration-level, and test-level confirmation via `git ls-tree`/`git show` on `production-ready` | **FULLY PUSHED** (to `production-ready`) / **PUSHED BUT NOT ON MAIN** |
| **Engine 4** — Provider Identity | Provider/org verification | **Absent** | `173c2db` ("Service Engine 2.0" in its own commit message — this IS Engine 4 per the audit's numbering, see §3 naming note) — `src/lib/providers.ts`, `src/routes/api-provider.ts`, migrations 0025/0029 (0029 confirmed EMPTY/no-op placeholder — see its own header: "no new table could be attributed... intentionally-empty placeholder") | Confirmed via direct file read this session (both this audit and the prior Engine 8 audit read `providers.ts` and migration 0025/0029 in full) | **PARTIALLY PUSHED** — real state-machine code exists and is pushed to `production-ready`, but no admin verification API exists anywhere (confirmed via grep in the Engine 8 audit — zero `UPDATE ... SET verification_status` in application code) |
| **Engine 5** — Maps/GPS | Location tracking | **Absent** | `2420434` (schema reconstruction) — `migrations/0026_maps_gps_foundation.sql` (`gps_events` table only) | Confirmed via `git show`: **schema-only, zero application code** — no `src/lib` file, no route, references `driver_profiles`/`shipments` FKs | **PARTIALLY PUSHED** (schema exists and is pushed; zero service/API implementation exists anywhere in the repo) |
| **Engine 6** — Logistics / NaijaSend | Delivery/dispatch/driver/tracking | **Absent** | `f5ba574` (Logistics Engine 2.0 foundation) + `769fca2` (Proof Gate: 3 real bugs fixed via live E2E) — `src/lib/logistics-{delivery,dispatch,drivers,naijashop-bridge,pricing,shipments,tracking}.ts`, `src/routes/api-logistics.ts`, migrations 0015/0016/0019/0020/0035/0036/0042 | Full file-level confirmation via `git ls-tree` on `production-ready`; the Proof Gate commit message itself documents genuine live-testing (not just claimed) | **FULLY PUSHED** (to `production-ready`) / **PUSHED BUT NOT ON MAIN** |
| **Engine 7** — Payment & Finance | Wallet/ledger/escrow/payouts/NaijaPay | **Partial** (`wallet.ts`, `paystack.ts`, `money.ts` — the Phase-1 MVP wallet — exist on BOTH branches) | Same wallet/paystack/money files, PLUS `src/lib/order-settlement.ts` and `migrations/0014_seller_finance_ledger.sql` (`seller_ledger` table) exist ONLY on `production-ready` | No escrow, no payout execution, no NaijaPay-specific code found on either branch (consistent with this session's own prior finding that Engine 7's Phase 1 audit has never been started) | **PARTIALLY PUSHED** — the wallet/ledger foundation IS on `main` (unlike every other engine above); the settlement/seller-ledger extension is PUSHED BUT NOT ON MAIN; the full Engine 7 spec (escrow, payouts, NaijaPay) is **UNKNOWN / not yet built anywhere**, exactly as stated at the top of this session |
| **Engine 8** — Trust/Safety/Reviews | Reviews/verification/disputes/fraud/moderation | **Absent** (main's `reviews` table is product-only, no `reviewable_type` column — confirmed: `main`'s migrations stop at 0012, before migration 0027 which adds polymorphism) | `2420434` (schema reconstruction, migration 0027: polymorphic `reviews` + `review_status_events`) + `fc18217` (this session's Phase 1 audit doc, `docs/ENGINE-8-TRUST-SAFETY-AUDIT.md`) | Confirmed via `git show origin/production-ready:migrations/0027...` and `git show origin/production-ready:docs/ENGINE-8-TRUST-SAFETY-AUDIT.md` — both present and readable from the fetched remote ref, independent of local working tree | **PUSHED BUT NOT ON MAIN.** Zero Engine 8 implementation exists anywhere (consistent with this session's own audit finding — confirmed again from the remote side, not just the local working copy) |

---

## 10. Final GitHub Integrity Matrix

| Item | Classification |
|---|---|
| `main` branch itself | Real, self-consistent, 43 real commits, zero unexplained gaps — but stale (Engine-1-Phase-1 + docs only) |
| `production-ready` branch itself | Real, self-consistent, 57 real commits, strict superset of `main`, zero unexplained gaps |
| `production-reconstruction` branch | Real, ancestor of `production-ready`, not a separate lineage — safe to treat as fully subsumed |
| Engine 1 (Marketplace 2.0/2.1) | PARTIALLY PUSHED (MVP on main; 2.0/2.1 depth on production-ready only) |
| Engine 2 (Control Center/Integration Hub) | PARTIALLY PUSHED (RBAC+audit+admin API real; Integration Hub schema-only) |
| Engine 3 (Booking Engine) | FULLY PUSHED to production-ready / PUSHED BUT NOT ON MAIN |
| Engine 4 (Provider Identity) | PARTIALLY PUSHED (state machine real; no admin mutation API) |
| Engine 5 (Maps/GPS) | PARTIALLY PUSHED (schema only, zero app code) |
| Engine 6 (Logistics/NaijaSend) | FULLY PUSHED to production-ready / PUSHED BUT NOT ON MAIN |
| Engine 7 (Payment & Finance) | PARTIALLY PUSHED (wallet MVP on main; settlement extension on production-ready; escrow/payouts/NaijaPay UNKNOWN — not yet built) |
| Engine 8 (Trust/Safety/Reviews) | PUSHED BUT NOT ON MAIN (audit doc only; zero implementation exists anywhere) |
| 15 requested legacy short SHAs | STRANDED / NOT FOUND (exhaustively checked: local object DB, GitHub API, all 14 sibling repos, global search — negative on every positive-evidence check) |
| Production's live deployed build (`99b1664...`) | STRANDED (documented independently on `main` itself prior to this session; source never recovered, confirmed absent from git history on any branch, this session) |
| Commits reachable from `production-ready` but not `main` | 14 (fully enumerated in §3, all individually verified on GitHub) |
| Commits reachable from `main` but not `production-ready` | 0 |
| Superseded/reimplemented engine work | None found (production's lost build was reconstructed from schema, not superseded from a still-present prior implementation) |

---

## 11. What This Audit Does NOT Claim

- This audit does not claim Engines 3 and 6 (Booking, Logistics) are
  "production ready" in the colloquial sense — only that their code, as it
  exists, is genuinely committed and pushed to `production-ready` on GitHub,
  file-for-file verified.
- This audit does not claim the 15 unresolved short SHAs never existed in any
  sandbox, ever — only that no trace of them exists in this repository, this
  GitHub account's other repositories, or GitHub's object-lookup API today.
- This audit does not evaluate code quality, test coverage adequacy, or
  security posture of any engine beyond what the companion
  `docs/ENGINE-8-TRUST-SAFETY-AUDIT.md` already covered for Engine 8. That is
  explicitly out of scope for a remote-integrity audit.
- This audit did not modify, merge, rebase, cherry-pick, or force-push
  anything, per its own mandatory constraints — every command run was
  read-only (`fetch`, `rev-parse`, `merge-base`, `log`, `ls-tree`, `show`,
  `cat-file -e`, `fsck`, `reflog`, plus GitHub REST `GET` calls only).

---

## 12. Immediate Actionable Finding (for Pat's decision, not this audit's to decide)

**The repository's default branch (`main`) does not reflect the actual state
of engine development.** Anyone or anything that treats `main` as "the
codebase" — a new collaborator, a CI/CD pipeline, a fresh sandbox bootstrap —
will see a 12-migration, single-vertical MVP with no tests, missing 6.5
engines' worth of real, working, pushed code that already exists one branch
over. This is a **branch-hygiene gap, not a data-loss problem** — nothing
described in this audit requires reconstruction; it requires a decision about
whether/when to fast-forward or merge `main` to `production-ready`'s state,
which this audit deliberately did not perform (out of scope, and explicitly
forbidden by this audit's own constraints: no merge, no rebase, no reset).
