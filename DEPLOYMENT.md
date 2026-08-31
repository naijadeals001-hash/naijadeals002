# NaijaDeals Deployment Pipeline — Permanent Project Rule

**Status: NON-NEGOTIABLE. Adopted 2026-08-31 after a production incident.**

## The incident this rule exists to prevent

On 2026-08-30/31, migrations `0005_account_experience.sql` through
`0008_hero_campaigns.sql` were written, committed, and pushed to `main`. The
deployed Cloudflare Worker was built from that commit. **But the hosted
production D1 database was never migrated** — it stayed frozen at `0004`. The
homepage (`/`) began returning `HTTP 500` on both the Genspark deployment URL
and `https://naijadeals.com`, because `getActiveHeroCampaigns()` queried a
`hero_campaigns` table that existed in the deployed code's expectations but
not in the deployed database's actual schema. This went undetected because
nothing in the deploy path checked "does the database schema match what this
code expects" — a commit was treated as "deployed" the moment it was pushed
and built, without that check ever running.

**This must never happen again.** A commit containing `migrations/0009_x.sql`
is not considered deployed until the production database also reports
`0009_x.sql ✓` in its `d1_migrations` table — verified live, not assumed.

## The honest version of the pipeline

The originally requested pipeline (GitHub push → fully automatic zero-touch
build/migrate/deploy/publish) is **not fully achievable on this platform by
design**, and that's a deliberate safety property, not a gap to be engineered
around:

- `gsk hosted deploy` (publish) and any DDL migration via `gsk hosted d1_execute`
  (CREATE/ALTER/DROP) **always** return `pending_approval` and require a human
  to approve in the Genspark deployment panel. No agent, script, or webhook can
  skip this. For an app that moves real money (Paystack, wallet, orders), an AI
  agent having unilateral, unreviewed write access to the production database
  and public app is not a risk worth accepting for convenience.
- There is no GitHub webhook connecting `git push` to this sandbox — nothing
  fires automatically when `main` changes. A human (Pat) or the assistant acting
  on Pat's request must initiate each deploy cycle.

**What IS fully automatic (zero human touch, every time):**

| Stage | Mechanism |
|---|---|
| Build | `npm run build`, part of `scripts/verify_deployment.cjs` |
| Local migration-list check | `scripts/verify_deployment.cjs` Gate 3 |
| Playwright/visual verification (pre-push) | `scripts/verify_deployment.cjs --local-only`, or full run against a live host |
| Post-deploy: SHA match, migration parity, route smoke test, HTTP code check, asset resolution, responsive smoke test | `scripts/verify_deployment.cjs` Gates 4–8, via `/api/version` + real HTTP/browser checks against both hosts |
| Reporting exact deployed Git SHA | `/api/version` (baked in at build time, cannot be faked or guessed) |

**What requires one human click, every time (by platform design):**

| Stage | Mechanism |
|---|---|
| Apply pending DB migrations to hosted D1 | `gsk hosted d1_execute` → pending_approval → Pat approves in Genspark UI |
| Publish the build to the Worker | `gsk hosted deploy` → pending_approval → Pat approves in Genspark UI |

The assistant's job is to run every automatic gate, present the two approval
requests together (batched, not one-at-a-time), and refuse to report
"deployed" or "production-ready" until every gate — automatic and
human-approved — is confirmed green.

## The 8 gates (every deploy, no exceptions)

Implemented in `scripts/verify_deployment.cjs`. Run with:

```bash
# Pre-push (local only, no deployment URL needed):
node scripts/verify_deployment.cjs --local-only

# Post-deploy (full check against both live hosts):
node scripts/verify_deployment.cjs \
  --deployment-url https://<project-id>.vip.gensparksite.com \
  --custom-domain https://naijadeals.com
```

1. **Repository** — `git rev-parse HEAD` == `git rev-parse origin/main`, working
   tree clean. Fails if local commits are unpushed or the tree is dirty.
2. **Build** — `npm run build` must succeed and produce `dist/_worker.js`.
   Fatal: if this fails, no downstream gate runs (a broken build cannot pass
   anything else honestly).
3. **Database (local)** — confirms `migrations/*.sql` exist and lists them.
   The live parity check against the *hosted* database happens in Gate 5 via
   `/api/version` — this gate is the "what does this commit expect" half.
4. **Application routes** — `/`, `/shop`, `/shop/:slug`, `/cart`, `/checkout`,
   `/account/wishlist`, `/account/addresses` are fetched on both hosts.
   Auth-gated routes redirecting to `/login` (302) for an unauthenticated smoke
   visitor is expected and passes — that is correct behavior, not a failure.
5. **Public deployment identity + migration parity (live)** — `GET /api/version`
   on both the Genspark deployment URL and `https://naijadeals.com`. Confirms:
   - HTTP 200 (the endpoint itself returns 503 if the DB is unreachable or out
     of sync — so this single call encodes both "is it up" and "is it correct")
   - `git_sha` in the response == local `HEAD` (deployed code isn't stale)
   - `db.in_sync == true` (no missing migrations) — **this is the exact check
     that was missing during the incident**, now impossible to silently skip.
6. **HTTP status codes** — no `500`/`502`/`503`/`504` anywhere a valid route is
   expected. Folded into Gates 4 and 7.
7. **Assets** — every category of DB-referenced image (product, vendor logo,
   review avatar, hero banner) is spot-checked for `404`/`5xx` on both hosts.
8. **Responsive smoke test** — real Playwright browser navigation to `/` at
   1440px, 1280px, 430px, 390px, 375px on both hosts, screenshotted, checked for
   forbidden HTTP codes and JS `pageerror` events.

**A commit is only "DEPLOYMENT VERIFIED" when all 8 gates pass on both the
Genspark deployment URL and `https://naijadeals.com`.** Any single gate
failure produces `DEPLOYMENT FAILED` in the script's output and a non-zero
exit code — this must be reported to Pat as failed, never smoothed over as
"mostly working" or "pushed and synced."

## The three-way SHA identity that defines "done"

```
GitHub HEAD (origin/main)
        =
Deployed application SHA (from /api/version on the Genspark deployment URL)
        =
Verified public application SHA (from /api/version on https://naijadeals.com)
```

A milestone is complete only when all three match AND `db.in_sync == true` on
both hosts. Reporting "pushed to GitHub" is not reporting "deployed." Reporting
"deployed" without having queried `/api/version` on the live host is not
acceptable and will not be done.

## Full workflow (per meaningful commit — not batched across several)

```
Developer/assistant changes
       ↓
npm run build                                    (Gate 2)
       ↓
Tests (unit/integration, when they exist)
       ↓
node scripts/verify_deployment.cjs --local-only   (Gates 1-3, Playwright pre-push)
       ↓
git commit
       ↓
git push origin main
       ↓
[HUMAN APPROVAL #1] gsk hosted d1_execute for any new migrations, if pending
       ↓
[HUMAN APPROVAL #2] gsk hosted deploy
       ↓
node scripts/verify_deployment.cjs --deployment-url ... --custom-domain ...
       ↓
   ALL 8 GATES PASS?
       ↓                              ↓
      YES                             NO
       ↓                              ↓
DEPLOYMENT VERIFIED           DEPLOYMENT FAILED
Report exact Git SHA          Stop. Report the failing gate(s) verbatim.
                               Do NOT claim deployed/production-ready.
```

**Checkpoint discipline:** run this full cycle after every meaningful commit —
not batched across several. The 2026-08-30/31 incident happened specifically
because four migrations accumulated across several commits before anyone
checked hosted-DB state. `COMMIT → DEPLOY → VERIFY → CHECKPOINT`, every time.

## What the assistant will never do

- Never claim "deployed", "live", "production-ready", "Preview: WORKING", or
  "everything is pushed and synced" without having just run
  `scripts/verify_deployment.cjs` against the live host(s) and gotten
  `DEPLOYMENT VERIFIED`.
- Never run `gsk hosted d1_execute` (DDL) or `gsk hosted deploy` silently —
  both require Pat's explicit approval via the pending-action handshake, every
  single time, no exceptions for "it's just a small migration."
- Never treat a GitHub push as equivalent to a deploy.
- Never batch four migrations' worth of drift before checking hosted-DB state
  again — one commit, one verification cycle.
