# NaijaDeals — Production Codebase Recovery & Reconciliation Report

**Status:** Forensic investigation complete. Read-only. No application code, database, migration, seed, API, UI, configuration, deployment, or production state was modified while producing this report.

**Date:** 2026-09-12
**Investigator commit baseline (this repo, before this report):** `eca67bd03bba0cf3eae046a95fed63942e246790`
**Trigger:** `docs/NAIJADEALS-BASELINE-AUDIT.md` §33 finding that `https://naijadeals.com` is running a build not present in local Git history or on GitHub.

---

## 1. Current GitHub Baseline

| Item | Value |
|---|---|
| Repository | `naijadeals001-hash/naijadeals002` |
| Default branch | `main` |
| `main` HEAD (GitHub) | `eca67bd03bba0cf3eae046a95fed63942e246790` |
| `main` HEAD (local) | `eca67bd03bba0cf3eae046a95fed63942e246790` (match confirmed) |
| Total commits on `main` | 40 (`5b955cf8` → `eca67bd0`) |
| Branches | 1 (`main` only) |
| Tags | 2 (`naijadeals-bootstrap-repair-complete-2026-09-12`, `naijadeals-sop-checkpoint-2026-09-12`) |
| Releases | 0 |
| Open/closed PRs | 0 |
| GitHub Actions runs | 0 (`{"total_count":0,"workflow_runs":[]}`) |
| Deployments (GitHub Deployments API) | 0 |
| Repo description | **"This is the one on the website now"** (human-written, present tense, asserts this repo IS the live site's source) |
| Repo size | 17,765 KB |
| Created | 2026-08-30T22:57:18Z |
| Last pushed | 2026-09-12T02:09:38Z |
| Working tree (local, this session) | CLEAN |

---

## 2. Production SHA

```
git_sha: 99b1664df552ce1cd707330e17207d8869f12a4e
build_time: 2026-09-11T18:15:24.542Z
```

Re-confirmed live via `curl https://naijadeals.com/api/version` during this investigation (2026-09-12T02:28:56Z response). Identical SHA and build_time also returned by the Genspark deployment URL for the same Worker (`393ef41c-f7b9-4ded-996a-2f5265e3280d.vip.gensparksite.com`), confirming this is one Worker served under two hostnames, not two different deployments that happen to agree.

This SHA does **not** appear anywhere in:
- Local Git (`.git` object database, reflog, packed-refs, all branches/tags/stash) — confirmed absent.
- GitHub `naijadeals002` (all branches, tags, releases, PR diffs, Action artifacts).
- GitHub's global commit search (`gh api search/commits -f q=<sha>`) → `{"total_count":0}`.
- GitHub's global code search (`gh api search/code -f q=<sha>`) → `{"total_count":0}`.
- Any of the other 4 sibling repositories under `naijadeals001-hash` (checked by branch/commit listing where non-empty).

---

## 3. Production Migration Count

Production's live `/api/version` reports **36 applied migrations**, `0001_initial_schema.sql` through `0036_naijasend_vehicle_type_expansion.sql`, with `db.in_sync: true`, `missing_migrations: []`, `unexpected_migrations: []`. Both `expected_migrations` (baked into the Worker bundle at build time by reading the `migrations/` directory) and `applied_migrations` (queried live from `d1_migrations` in the hosted D1) list is **identical** — this is strong, mechanism-verified evidence that a real `migrations/` folder with 36 real `.sql` files existed in whatever build produced this Worker. This is not a display artifact; `getExpectedMigrations()` (see `vite.config.ts`) literally cannot report a migration file it didn't find on disk at build time.

## 4. Local Migration Count

Local `migrations/` directory contains **12 files**, `0001_initial_schema.sql` through `0012_locale_preference.sql` — file-for-file identical in name and (spot-checked) intent to production's first 12. Migrations `0013` through `0036` (24 files) do not exist anywhere in this repo, at any commit, on any branch.

## 5. Evidence of Production Divergence

| Signal | Local/GitHub (`naijadeals002`) | Production (`naijadeals.com`) |
|---|---|---|
| git_sha | `eca67bd03bba0cf3eae046a95fed63942e246790` | `99b1664df552ce1cd707330e17207d8869f12a4e` (unknown to us) |
| Migrations | 12 | 36 |
| `/send`, `/fresh`, `/eats`, `/gigs`, `/stay` routes | Shared placeholder/ecosystem pages | Genuinely distinct vertical-specific pages and schemas |
| D1 table count | 33 tables (from local migrations) | 106 tables |
| Systems present | Marketplace core, wallet, ecosystem waitlist | + Control Center, Integration Hub, Affiliates, Booking Engine, Provider Identity, Maps/GPS, polymorphic Reviews, NaijaSend logistics/driver/shipment/vehicle-marketplace |

This is the same divergence already fully documented in `docs/NAIJADEALS-BASELINE-AUDIT.md` §33; this report adds the forensic *origin* investigation on top of that already-established fact pattern.

---

## 6. Git Forensic Findings

Commands run (all read-only, nothing deleted or garbage-collected):

```
git reflog --all
git fsck --full --no-reflogs --unreachable --dangling
git branch -a -v
git tag -l -n99
git stash list
cat .git/packed-refs
find .git/refs -type f
git cat-file -t 99b1664...          (and 99b1664df5...)
git rev-parse 99b1664 (and variants)
git count-objects -v
grep -r 99b1664 .git/
```

**Result: zero trace.** No dangling commit, no unreachable blob, no alternate object store, no stash entry, no packed-ref, no reflog entry anywhere references `99b1664` in whole or in short form. Local history is a single clean linear chain of 40 commits from `5b955cf8` (Initial commit) to `eca67bd0` (this session's baseline audit). This conclusively rules out "the commit exists locally but is orphaned/unreachable" — it was never present in this sandbox's Git object database at all.

## 7. GitHub Forensic Findings

**`naijadeals002` (current repo):** Fully self-consistent. One branch, two tags, zero releases/PRs/Actions/Deployments. Commit history on GitHub matches local exactly, commit-for-commit, including timestamps. Push event history has no gaps. **Notable internal detail:** commit authorship transitions from `genspark_dev` (commits through `9cead089db`, 2026-08-30T23:21:56Z) to `naijadeals001-hash` (from `4c71498a88` onward, 2026-08-31T00:10:57Z) — consistent with a session/account-identity boundary, not evidence of a missing commit.

**Sibling repositories under `naijadeals001-hash`** (discovered via `gh api users/naijadeals001-hash/repos`, not previously known to this investigation):

| Repo | Size (KB) | Last pushed | Branches | Relevance |
|---|---|---|---|---|
| `naijadeals002` | 17,765 | 2026-09-12 | 1 (`main`) | Current repo — ruled out as hiding the SHA (see §6/§7 above) |
| `naijadeals` (no numeral) | 388,622 | 2026-08-05 | 2 (`main`, `feature/m1-phase1-identity`) | **Key lead — see below** |
| `Milestone-1` | 0 | — | 0 | Empty. Never populated despite a description naming several missing systems (Identity/Auth/RBAC/Wallet/Escrow/Notifications/Messaging/Search/Integration Gateway/Aura AI/Admin/Docker/CI-CD). Dead end. |
| `Vinyl-Project-Phases-and-Structure` | 0 | 2026-08-05 | — | Empty/unrelated by name and size. Not a plausible source. |
| `WholeWard-Health-LLC-Core-Development-Directive-` | 0 | 2026-08-05 | — | Empty/unrelated — corresponds to the separate WholeWard Health client project already known from unrelated Genspark hosted resources (project `2000cc0a-...`). Not a plausible source. |

### `naijadeals` (no-numeral) repo — detailed findings

- **`main` branch** (commits 2026-07-05 → 2026-07-14, all titled "Add files via upload"): a bulk-uploaded **Genspark Design canvas export** — hundreds of mockup-screen directories (`admin_command_center`, `aura_ai_master_ecosystem_command_terminal`, `naijaagro_*`, `naijadrive_*`, `naijaeats_*`, `naijagigs_*`, etc.) plus vision/strategy documents (`naijadeals_definitive_master_ecosystem_audit_strategic_roadmap.md`, `naijadeals_development_philosophy.md`, `naijadeals_ecosystem_architecture_audit.md`, `naijadeals_final_architecture_book.md`, `naijadeals_investor_book_operating_plan.md`, `ARCHITECTURE.md`, `PROJECT_RULES.md`). This is a **design/vision artifact**, not a deployable codebase — no `wrangler.jsonc` anywhere (confirmed via `gh api search/code` scoped to this repo, `total_count: 0`).
- **A GitHub Release exists on this repo: `stitch-baseline-v1.0`** (tag `stitch-baseline-v1.0`, commit `b1f4005...`, published 2026-08-05T00:08:32Z). Its release body is highly informative and is quoted here in full because it directly names the architecture-governance lineage relevant to this investigation:

  > "This release marks the official UI reference baseline and governance freeze for the NaijaDeals Super Ecosystem repository. **Stitch enterprise module structure**: 1,558 classified directories reorganized into `stitch/`... **Phase 1.1 implementation preserved**: The merge reconciled local governance commits with the remote `feature/m1-phase1-identity` branch containing the Identity & Authentication Foundation implementation... `stitch/` is the official UI reference library, **not the production frontend**. Production implementations may improve, modernize, consolidate, and redesign while preserving business intent... The next authorized work is **Phase 1.1 implementation on `feature/m1-phase1-identity`, subject to explicit authorization**."

  This confirms, in the project's own historical record, that `naijadeals`/`stitch` was always intended as a **UI/design reference library**, explicitly distinct from whatever "production implementation" would eventually be built — consistent with this report's conclusion below that this repo is the *design origin*, not the *code source*, of production.
- **`feature/m1-phase1-identity` branch** (single commit, 2026-08-05T02:54:49Z, "chore(deploy): configure Next.js static export for Genspark Hosting"): a **Next.js + Prisma + Turborepo monorepo skeleton** (`apps/platform-api`, `apps/web`, `packages/`, `prisma/`, `docker-compose.yml`, `turbo.json`, `vitest.config.ts`). Its own README explicitly states this is "Milestone 1.0 Platform Foundation" that "intentionally stops at infrastructure, contracts, and shared engineering patterns" and **explicitly excludes** "Business logic and business workflows... Wallet, escrow, messaging, search, commerce, or AI execution." No Actions runs, no additional branches, no further commits on this branch (checked this session — `gh api repos/naijadeals001-hash/naijadeals/actions/runs` → `{"total_count":0}`, `pulls?state=all` → `[]`).
- **Tech-stack mismatch is decisive:** production (`naijadeals.com`) is unambiguously Hono + Cloudflare D1 + Wrangler (confirmed via `/api/version`'s exact field shape, which matches this repo's own `src/routes/version.ts` mechanism byte-for-byte, and via the 106-table D1 schema being genuine SQLite/D1 DDL). The `naijadeals` repo's only code branch is Next.js/Prisma/Postgres/Turborepo — a structurally incompatible stack that cannot produce a Cloudflare D1-backed `/api/version` response. Combined with its self-declared "excludes all business logic" scope and its 5+-week-stale timestamp relative to production's `build_time` (2026-08-05 vs. 2026-09-11), **this branch is conclusively ruled out as the source of the running production code.**

## 8. Deployment Forensic Findings

`naijadeals.com` is served by Cloudflare Worker `393ef41c-f7b9-4ded-996a-2f5265e3280d` (Genspark-hosted, namespace `user_website`), bound to the custom domain via `custom_domain_add` on 2026-08-30T21:42:34Z, with D1 database UUID `bbbd12bf-e8cd-4e14-8413-76ed8b96ed1e` and an R2 bucket, both attached the same day the Worker itself was (re)created, 2026-09-11T18:15:56Z (this ctime matches `build_time` to the second, consistent with the most recent `gsk hosted deploy` publish event, not necessarily the *original* creation of this data).

This project's `DEPLOYMENT.md` (read in full this session) documents the **exact deployment pipeline in force**: `git push` → human-approved `gsk hosted d1_execute` for pending migrations → human-approved `gsk hosted deploy` to publish. Critically, `DEPLOYMENT.md` **already documents a prior, materially identical incident**:

> "On 2026-08-31, Gate 5 reported a `git_sha` mismatch on both hosts (`naijadeals.com` and the Genspark deployment URL both returned `191304ce75b02412...`) while local `HEAD` was `98a50998618ec7df8a23980f8...`. ... The reported SHA does not exist anywhere in local git history... Root cause (best available evidence): this is a Genspark hosted-build pipeline metadata-stamping quirk... The `git_sha` baked into the Worker bundle via `vite.config.ts`'s `getBuildGitSha()` (`execSync('git rev-parse HEAD')`) appears to run inside a build-time environment on Genspark's side whose working directory is not always byte-identical to the exact commit that ends up published."

This is important prior-art, but it **does not fully explain the current divergence**, for one decisive reason: that prior incident's `db.in_sync` was `true` with the *same* 8 migrations expected and applied on both sides — i.e., the code that ran was functionally identical to local HEAD, just mis-stamped. The current divergence is different in kind: production's `expected_migrations` list itself contains **24 additional real filenames** (`0013_control_center_foundation.sql` through `0036_naijasend_vehicle_type_expansion.sql`) that were read from an actual `migrations/` directory at build time — a metadata-stamping quirk explains a wrong *label* on identical code, but it cannot explain a build reading 36 real files from disk when the pushed source only ever contained 12. **This proves an entire divergent codebase was pushed and deployed through this exact same `gsk hosted deploy` pipeline at some point, from a git working tree this sandbox has never seen** — not a labeling artifact.

Regarding the mega-prompt's options A–G: evidence points most strongly to **(D) an unpushed/reset Genspark workspace** — i.e., a different sandbox/session, working against this same Genspark project (`393ef41c-...`), built up all 24 additional migrations plus their corresponding Hono routes/schemas, deployed them via `gsk hosted deploy` (which requires no GitHub push at all — deploy publishes directly from the sandbox's local working tree), and was subsequently lost or reset without those local commits ever reaching GitHub. This is fully consistent with the already-documented "total sandbox loss" incident in `docs/ENGINEERING-SOP-BACKUP-RULE.md` (2026-09-12: "a sandbox loss destroyed an entire in-progress Lifecycle-A implementation... that had never been pushed to GitHub"), though that specific log entry only accounts for NaijaSend Lifecycle-A (driver/shipment), not the full 24-migration scope (Control Center, Integration Hub, Affiliates, Booking Engine, Provider Identity, Maps/GPS, Reviews, and the real NaijaEats/Gigs/Stay/Fresh implementations). The most defensible reading is that **multiple such sandbox-loss episodes accumulated across several sessions between 2026-08-31 and 2026-09-11**, each pushing forward via direct `gsk hosted deploy` without ever landing the corresponding source on `origin/main` — and only the most recent deploy's SHA (`99b1664...`) survives as a fingerprint, because Worker deploys overwrite the previous bundle; there is no history of intermediate deploys.

Options A (another repo), B (another branch), C (an orphaned commit), E (a different Genspark project), and F (an older snapshot) are addressed and substantively ruled out or down-weighted in §6, §7, and §9 below. Option G ("another source entirely") cannot be fully excluded but has no positive evidence.

## 9. Workspace/Artifact Findings

- **`recall_past_projects`-equivalent lookup attempted, failed at the tool level** ("function call failed, not handled") rather than returning a semantic "no results" — this avenue remains genuinely untested, not negative evidence.
- **`gsk hosted list`** enumerated all 27 hosted resources across 7 distinct Genspark project IDs owned by this account. Of these, 3 previously unknown to this investigation were inspected this session using `gsk --project-id <id> hosted worker_get` / `d1_schema` (confirmed this flag works to scope hosted commands to a non-current project):

  | Project ID | Worker ctime | Content found | D1 | Verdict |
  |---|---|---|---|---|
  | `73f5bf7e-3453-416e-afce-a242f823ece5` | 2026-08-05T03:51:47Z | Root page = default Hono template ("Hello!") | No D1 deployed | Never-customized scaffold. Ruled out. |
  | `28266969-0059-4baf-a32e-34674072227a` | 2026-08-05T14:10:33Z | Root page = "WholeWard Health" React SPA (`<title>WholeWard Health</title>`) | D1 exists but **0 tables** | Belongs to the unrelated WholeWard Health client project (an early/duplicate provisioning of it — a second, unused WholeWard Worker/D1/R2 triple exists at `28266969-...` in addition to the "real" one at `2000cc0a-...`). Not NaijaDeals-related. Ruled out. |
  | `6e729329-58b2-4e46-bc77-5042f24f03aa` | 2026-08-09T02:08:39Z | Root page **is** a NaijaDeals-branded static site ("NaijaDeals — The Digital Marketplace for Africa", NaijaDeals color tokens `nd-green`/`nd-orange`, `app.js` + `data.js`) | **No D1 deployed at all** | See detailed analysis below. |

  **`6e729329-...` detailed analysis:** This is a genuinely NaijaDeals-branded deployment, but on inspection its `app.js` (150 KB) and `data.js` (24 KB) are a **pure client-side, hash-routed, hardcoded-mock-data static prototype** — no `/api/version` endpoint exists (404), no backend routes, no D1/R2 bindings of any kind, and `NaijaShop` is the only vertical name found anywhere in its source (35 occurrences; zero occurrences of NaijaFresh/Eats/Gigs/Stay/Drive/Send/Stream/Aura AI/Control Center/Affiliate/Booking Engine). Its data (`ND_DATA.categories`, `ND_DATA.products`) is fabricated Unsplash-image mock content for a buyer-journey demo, structurally unrelated to the real Hono/D1 marketplace this repo implements. Its ctime (2026-08-09) predates production's first real deploy pattern and is not evidence of the source for the 36-migration build. **Ruled out as the source, but flagged as an interesting historical artifact:** it appears to be an early, disposable "Stitch"-style client-only mockup of the NaijaShop vertical specifically, consistent with the design-lineage described in §7 above, not a functional backend prototype.

- **No other unexplained Genspark projects remain in `gsk hosted list`'s 27-resource output** — the remaining resources all belong to clearly identified, unrelated client projects (`dsv24ltd.com`, `adhesivedesignstudios.com`, `wholewardhealth.com`) that were already known before this investigation and are not plausible NaijaDeals sources.
- **No mechanism exists to retrieve a deployed Worker's actual source code** through any `gsk hosted` command — only D1 data/schema (`d1_schema`/`d1_export`/`d1_query`), R2 objects (`r2_list`/`r2_get`), and coarse Worker metadata (`worker_get`: URL, namespace, timestamps) are inspectable. This is a hard platform limitation, not a gap in this investigation's thoroughness: **even if the exact originating sandbox/session were identified, its TypeScript/Hono source files are not retrievable via any read-only tool available to this investigation.** Only the *data* it left behind (the D1 schema and rows) is recoverable this way.

## 10. Production Schema Findings

Captured via `gsk hosted d1_schema` against the live production D1 (`bbbd12bf-e8cd-4e14-8413-76ed8b96ed1e`, project `393ef41c-...`), cached at `/tmp/prod_schema_full.json` (90,963 bytes, not part of this repo). **106 tables total** vs. local's 33 (derivable from local's 12 migration files). All 33 local table names are a strict subset of production's 106 — production is additive, not divergent, at the schema level; every locally-known table exists in production, plus 73 more.

New tables absent locally, grouped by system (73 total):

- **Control Center (`cc_*`, 12 tables):** `cc_alerts`, `cc_audit_logs`, `cc_capabilities`, `cc_capability_country_overrides`, `cc_countries`, `cc_country_settings`, `cc_domain_events`, `cc_integration_country_overrides`, `cc_integration_providers`, `cc_integrations`, `cc_permissions`, `cc_role_permissions`, `cc_roles`, `cc_system_health`, `cc_user_roles`
- **Affiliate system (11 tables):** `affiliate_accounts`, `affiliate_attributions`, `affiliate_campaigns`, `affiliate_clicks`, `affiliate_commissions`, `affiliate_fraud_events`, `affiliate_ledger`, `affiliate_payouts`, `affiliate_profiles`, `affiliate_referral_codes`
- **Booking Engine (4 tables):** `bookable_listings`, `booking_availability_blocks`, `booking_status_events`, `bookings`
- **Provider Identity (3 tables):** `provider_organizations`, `provider_profile_status_events`, `provider_profiles`
- **Maps/GPS (1 table):** `gps_events`
- **NaijaEats (real, 12 tables):** `cuisines`, `dishes`, `eats_cart_items`, `eats_carts`, `eats_order_item_options`, `eats_order_items`, `eats_order_status_events`, `eats_orders`, `menu_item_option_groups`, `menu_item_options`, `menu_items`, `menu_sections`, `menus`, `restaurant_status_events`, `restaurants`
- **NaijaSend logistics/driver/shipment/vehicle (14 tables):** `delivery_jobs`, `driver_documents`, `driver_profiles`, `driver_vehicle_assignments`, `logistics_providers`, `pickup_jobs`, `shipment_addresses`, `shipment_items`, `shipment_rate_cards`, `shipment_status_events`, `shipments`, `vehicle_documents`, `vehicle_photos`, `vehicle_types`, `vehicles`
- **NaijaGigs (1 table):** `gig_service_details`
- **NaijaStay (3 tables):** `stay_properties`, `stay_property_status_events`, `stay_unit_details`
- **Reviews foundation (1 table):** `review_status_events`
- **Seller finance / imports (3 tables):** `product_import_batches`, `product_import_rows`, `seller_ledger` (distinct from local's `seller_finance_accounts`, present in both)

This mapping table (repeated in a compact form as required by the mega-prompt) — full PRODUCTION CAPABILITY / EVIDENCE / LOCAL EQUIVALENT / STATUS / LIKELY SOURCE / RECOVERY POSSIBILITY / ACTION:

| Capability | Production Evidence | Local Equivalent | Local Status | Likely Source | Recovery Possibility | Action |
|---|---|---|---|---|---|---|
| Control Center | 15 `cc_*` tables, `0013_control_center_foundation.sql` | None | Absent | Lost sandbox session, deployed via `gsk hosted deploy` without a GitHub push | **Data-only** (schema/rows via `d1_schema`/`d1_export`); source code not recoverable | Do not rebuild. Await authorized reconciliation. |
| Integration Hub | Implied by `0023_integration_hub.sql` + `cc_integration_providers`/`cc_integrations` | None | Absent | Same as above | Data-only | Do not rebuild. |
| Booking Engine | 4 tables, `0024_booking_engine_foundation.sql` | None | Absent | Same as above | Data-only | Do not rebuild. |
| Provider Identity | 3 tables, `0025_provider_identity_foundation.sql`, `0029_provider_verification_rbac.sql` | None | Absent | Same as above | Data-only | Do not rebuild. |
| Maps/GPS | `gps_events`, `0026_maps_gps_foundation.sql` | None | Absent | Same as above | Data-only | Do not rebuild. |
| Reviews (polymorphic) | `review_status_events`, `0027_polymorphic_reviews_foundation.sql` | Basic `reviews` table only (product-scoped) | Partial | Same as above | Data-only | Do not generalize `reviews` yet. |
| NaijaSend (real) | 14 tables (logistics/driver/shipment/vehicle), migrations `0015,0016,0019,0020,0035,0036` | Ecosystem placeholder page only | Absent | Confirmed partial match to documented "total sandbox loss" incident (NaijaSend Lifecycle-A) | Data-only | Do not rebuild. |
| Drivers | `driver_profiles`, `driver_vehicle_assignments`, `driver_documents` | None | Absent | Same as NaijaSend | Data-only | Do not rebuild. |
| Shipments | `shipments`, `shipment_addresses`, `shipment_items`, `shipment_rate_cards`, `shipment_status_events` | None | Absent | Same as NaijaSend | Data-only | Do not rebuild. |
| Vehicles | `vehicle_types`, `vehicles`, `vehicle_documents`, `vehicle_photos` | None | Absent | Same as NaijaSend | Data-only | Do not rebuild. |
| Affiliates | 11 tables, `0017/0018_affiliate_*.sql` | None | Absent | Lost sandbox session | Data-only | Do not rebuild. |
| NaijaEats (real) | 15 tables (restaurants/menus/dishes/cuisines/orders), `0032/0033_naijaeats_*.sql` | Ecosystem placeholder page only | Absent | Lost sandbox session | Data-only | Do not rebuild. |
| NaijaGigs (real) | `gig_service_details`, `0028_gigs_stay_customer_activation.sql`, `0030_gigs_marketplace_imagery.sql` | Ecosystem placeholder page only | Absent | Lost sandbox session | Data-only | Do not rebuild. |
| NaijaStay (real) | 3 tables, `0034_naijastay_foundation.sql` | Ecosystem placeholder page only | Absent | Lost sandbox session | Data-only | Do not rebuild. |
| NaijaFresh | `0031_naijafresh_categories.sql` (categories-level only; no separate Fresh product tables found — likely reuses `products`/`categories`) | Ecosystem placeholder page only | Absent | Lost sandbox session | Data-only | Do not rebuild. |
| RBAC | `0029_provider_verification_rbac.sql`, `cc_roles`/`cc_permissions`/`cc_role_permissions`/`cc_user_roles` | None (single flat `users` table, no roles) | Absent | Lost sandbox session | Data-only | Do not rebuild. |

## 11. Vertical Findings

Per the baseline audit (§ already established) and re-confirmed by this session's schema pull: production genuinely renders and stores distinct data for `/send`, `/fresh`, `/eats`, `/gigs`, `/stay` — backed by real, vertical-specific tables (see §10). Local/GitHub `main` renders shared ecosystem placeholder pages for all five, backed only by the generic `ecosystem_verticals`/`ecosystem_vertical_features` tables. **This is not a stylistic difference — production has actual order/booking/menu/shipment data models per vertical that local has never had.**

## 12. Shared-System Findings

Shared systems present in production but absent locally: Control Center (RBAC/roles/permissions/countries/integrations/system-health/audit-log/alerts), Integration Hub, Affiliate program, Booking Engine, generalized/polymorphic Reviews, Provider Identity (a shared identity model for sellers/drivers/restaurant-owners/property-owners across verticals), Maps/GPS event tracking. Shared systems present in both: users/sessions, wallet (accounts+ledger), carts/cart_items, orders/order_items, addresses, coupons, notifications, newsletter, nigerian_banks/nigerian_states reference data, seller finance (production adds `seller_ledger` alongside local's `seller_finance_accounts`).

## 13. Possible Source Locations

Ranked by plausibility, most to least likely:

1. **A different, now-lost Genspark sandbox/session** working against the same hosted project (`393ef41c-f7b9-4ded-996a-2f5265e3280d`), which built the 24 additional migrations and their application code over one or more sessions between 2026-08-31 and 2026-09-11, and deployed each increment via `gsk hosted deploy` directly from its local working tree — without ever pushing to `origin/main` on `naijadeals002`. Each deploy overwrote the Worker bundle from the prior one, so only the final SHA (`99b1664...`) is externally visible; no intermediate deploy history is retained by the platform in any way this investigation could access. **Strongly supported** by: (a) `DEPLOYMENT.md`'s own prior documented incident of an "unknown SHA not in git history" being explained as build/deploy pipeline behavior that runs from a sandbox's local tree; (b) `ENGINEERING-SOP-BACKUP-RULE.md`'s explicit account of "a sandbox loss destroyed an entire in-progress Lifecycle-A implementation... that had never been pushed to GitHub"; (c) the sheer scope (24 migrations, ~5 verticals, multiple shared systems) being far more plausibly the product of several substantial sessions than one.
2. **The `naijadeals` (no-numeral) repo's design/vision material** (`main` branch mockups + strategy docs, and the `stitch-baseline-v1.0` release) as the **conceptual blueprint** that whatever lost sandbox(es) implemented against — not itself a code source, but very plausibly the origin of *what* was built (the same vertical names, the same Control Center/Aura AI/Affiliate concepts appear as mockup directories there).
3. **A different Genspark hosted project never surfaced by `gsk hosted list`** — considered but has no positive evidence; `gsk hosted list` explicitly states it returns resources "across all of your projects" for the current user, so this would require either a different Genspark account/organization or a resource type not covered by `list`. Not ruled out with certainty, but no lead points here.
4. **Option E — reconstruction from behavior/schema alone** — explicitly NOT chosen; per the mega-prompt's own instruction, this is last-resort only, and options A–D have been investigated (not literally "recovered," but investigated to the point of exhaustion given available tools).

## 14. Recovery Candidates

- **Production's D1 schema and data are recoverable right now**, read-only, via `gsk hosted d1_schema` / `gsk hosted d1_export` / `gsk hosted d1_query` — this investigation already has a full schema snapshot (`/tmp/prod_schema_full.json`). This gives a complete, authoritative picture of *what data model* to reconcile toward, even without the original source code.
- **Production's R2 bucket contents** (`393ef41c-...-r2`) have not yet been enumerated in this session (though were referenced in the prior audit) and may contain seller-uploaded assets relevant to reconciliation — read-only listing available via `gsk hosted r2_list`.
- **The actual Hono/TypeScript source code that produced the 24 additional migrations and their routes/services/UI is NOT recoverable through any tool available to this investigation.** No `gsk hosted` command exposes Worker source; GitHub has no trace; local Git has no trace; the one other Genspark project with NaijaDeals branding (`6e729329-...`) is a client-only mock unrelated to this backend. Barring Pat locating an external backup (a different machine, a downloaded zip, a chat/session transcript, an AI Drive backup, etc. — outside the scope of what this sandbox's tools can search), **the source code must be treated as lost** even though the underlying schema/data is not.

## 15. Confidence Level

- **High confidence** that production's codebase and data model genuinely represents 5+ weeks of additional, real implementation work beyond what exists on `origin/main` — not a fluke, not a labeling artifact, not a different unrelated project. (Evidence: schema-mechanism-verified migration list, 73 additional real tables, vertical-specific rendered pages already confirmed in the prior baseline audit.)
- **High confidence** that this additional work was never pushed to GitHub, given the local Git repo's clean unbroken 40-commit history and GitHub's fully self-consistent state.
- **Medium-high confidence** that the proximate cause is one or more lost/reset Genspark sandbox sessions that deployed directly via `gsk hosted deploy` without a corresponding `git push` — this is the most evidence-backed hypothesis, corroborated by the project's own prior incident log and prior-documented sandbox-loss pattern, but it is inference from circumstantial and documentary evidence, not a directly observed causal chain (no tool available to this investigation can show "session X deployed at time Y" directly).
- **Low confidence, but non-zero**, that some fragment of the missing implementation exists outside the systems this investigation can search (a different Genspark account, a local download on Pat's own machine, a different AI Drive location not indexed by this session, etc.) — this cannot be ruled out and should be asked about directly rather than assumed away.
- **Conclusion is UNKNOWN, not NO, on recoverability of the source code** — the data model is recovered; the code is not found by any means available here, but "not found by this investigation" is not the same certainty as "proven not to exist anywhere."

## 16. Recommended Reconciliation Strategy

Given source code cannot be recovered but the target schema/data can be fully read:

1. **Do not reconstruct from scratch without authorization** (per the mega-prompt's own Section 12 instruction — this report proposes, but does not start, any reconstruction).
2. **If/when authorized, prefer schema-first, read-verified reconstruction**: use the already-captured production D1 schema (`/tmp/prod_schema_full.json`) as the literal, byte-for-byte target DDL for new local migrations `0013`–`0036`, rather than inventing new schema designs — this guarantees the rebuilt local database is byte-compatible with production's actual live schema, so a future `gsk hosted deploy` would be schema-additive/no-op against what's already there rather than conflicting.
3. **Rebuild application code (routes/services/UI) referencing production's real behavior**, not assumptions — e.g., use production's actual rendered `/send`, `/fresh`, `/eats`, `/gigs`, `/stay` pages (already screenshotted/analyzed in the prior baseline audit) as the functional spec, and the `naijadeals` repo's Design-canvas mockups (`stitch/` in the release notes) as the intended UI reference library the project's own governance history already designates it as.
4. **Do this reconciliation on a dedicated branch**, never on `main` directly, with the missing-migrations work landing as its own reviewable increment before touching any UI/route code — so a future `gsk hosted deploy` is auditable against a specific, pushed, GitHub-verified commit (closing exactly the gap that caused this divergence in the first place).
5. **Treat this as a process fix, not just a one-time recovery**: the `ENGINEERING-SOP-BACKUP-RULE.md` "commit+push+verify" discipline already adopted (2026-09-12) is the correct standing fix, but it should be extended with an explicit rule that **`gsk hosted deploy` must never be run from a working tree that has unpushed commits** — since that is the exact mechanical hole that allowed this divergence (deploy does not require a prior push). This is a policy recommendation for the next authorized step, not something this report implements.

## 17. Risks

- **Building new taxonomy/category systems, new vertical features, or new shared systems (Control Center, Affiliates, Booking Engine, RBAC, etc.) locally right now would create a second, incompatible implementation of systems that already exist and are live in production**, exactly the risk the mega-prompt's Section 7 warns against. Confirmed real risk, not hypothetical — production genuinely has all of these.
- **A careless `gsk hosted deploy` from this sandbox at any point before reconciliation would overwrite production's real 106-table application** with this repo's much smaller 33-table placeholder implementation, destroying the still-recoverable data-model reference (though the underlying D1 rows would likely survive a schema-additive deploy, per this project's documented "never drops tables unless `rebuild_db` is explicitly used" behavior — but this has NOT been tested and should not be assumed safe without explicit verification first).
- **The true source code may already be permanently gone** — if it only ever existed in a sandbox that has since been reset/reseeded, no amount of further searching within this Genspark account will find it. Time spent searching further should be weighed against the near-certainty of this outcome versus moving to an authorized, schema-guided reconstruction.
- **Schema-only reconstruction cannot recover business logic nuances** (validation rules, edge-case handling, exact API contracts, UI polish) that only ever existed in the lost source — a schema-first rebuild will need real design/engineering work, not a mechanical translation.

## 18. What MUST NOT Be Rebuilt Yet

Per the mega-prompt's explicit list, none of the following may be built until this report is reviewed and an explicit next step is authorized: NaijaFresh, NaijaEats, NaijaGigs, NaijaStay, NaijaDrive, NaijaSend, NaijaStream, Aura AI, Booking Engine, Logistics Engine, GPS/Maps, Affiliates, Control Center, Integration Hub, generalized Reviews, RBAC. This includes the previously-discussed Amazon-grade category/taxonomy system (Request 2 of this session), which remains explicitly paused.

## 19. Next Authorized Step

Awaiting Pat's decision among:

- **(a)** Authorize schema-first reconstruction on a dedicated branch (per §16), starting with migrations `0013`–`0036` copied verbatim from production's live schema, before any route/UI work — the most defensible path given source code is not recoverable but the data model is.
- **(b)** Ask Pat directly whether a source-code backup exists outside this investigation's reach (another machine, a downloaded archive, a different Genspark account/project, an AI Drive location, a chat/session transcript) before committing to reconstruction — cheap to ask, potentially avoids weeks of rebuild work.
- **(c)** Retry `recall_past_projects` (it failed at the tool level this session, not semantically) or any equivalent session-history lookup, as one more exhaustion step before concluding Option D territory (§10 of the original mega-prompt) is fully closed.
- **(d)** Something else Pat specifies.

**No implementation will begin on any option until Pat explicitly selects one.**
