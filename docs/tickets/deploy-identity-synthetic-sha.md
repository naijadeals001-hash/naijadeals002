# Deploy Identity: `/api/version` reports synthetic SHA under `gsk hosted deploy`

**Status:** OPEN
**Severity:** Medium (deployment provenance cannot be independently certified via `/api/version` alone; does not indicate wrong code was deployed)
**Discovered:** 2026-09-22, during Workstream C production deployment (naijadeals.com)
**Reporter:** AI CTO agent, on behalf of Pat

## Summary

After running `gsk hosted deploy` for commit `566328bbed3823d5372323f1cc6c625356609f37`
on branch `feature/ecosystem-live-gigs-stay-aura`, the deployed Worker's
`GET /api/version` endpoint reported a `git_sha` value that does not exist
as a git object anywhere in the repository's history, across any branch or
remote.

```text
Expected source SHA:
566328bbed3823d5372323f1cc6c625356609f37

Reported runtime SHA:
17314db60c61ec3faa8c8d4d60157b32231578a3

Observed:
Runtime SHA is not a Git object in repository history
(git cat-file -t 17314db60c61ec3faa8c8d4d60157b32231578a3
 -> "fatal: could not get object info"; checked across
 main, production-ready, production-reconstruction,
 feature/naijapay-phase1, feature/naijapay-visual-qa,
 feature/naijashop-fund-settlement, and
 feature/ecosystem-live-gigs-stay-aura, local and remote).

Local build:
SHA correctly embedded as 566328bb... in the pre-existing
local dist/_worker.js (built at 2026-09-22T00:17 from the
same working tree, immediately after the 566328b commit).

Remote artifact:
Content independently matches 566328b via multiple
corroborating fingerprints (see below) — this is a
provenance-reporting defect, not evidence that the wrong
code shipped.

Impact:
Deployment provenance cannot currently be established
using /api/version alone.

Workaround:
Corroborate deployment identity using source/content
fingerprints plus remote Git SHA until build provenance
is fixed.
```

## How `git_sha` is captured (for the investigator)

`vite.config.ts` bakes the SHA into the Worker bundle at **build time**,
since Cloudflare Workers have no filesystem/`child_process` at runtime:

```ts
function getBuildGitSha(): string {
  try {
    return execSync('git rev-parse HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}
// ...
define: {
  __GIT_SHA__: JSON.stringify(getBuildGitSha()),
  ...
}
```

`gsk hosted deploy`'s log (`result.log`) shows it builds the deployment
artifact **server-side** from the pushed branch snapshot
(`⏳ Building deployment artifact...` precedes `wrangler deploy`), rather
than uploading a locally pre-built `dist/`. Whatever `execSync('git rev-parse HEAD')`
resolved to inside that server-side build environment produced
`17314db6...` — a hash absent from this repo entirely. This points to the
platform's build-time checkout not being a literal clone of the pushed
commit (e.g. a repackaged/synthetic checkout, a squash/rebuild step, or
git metadata being regenerated rather than preserved), but the exact
mechanism was **not confirmed** — flagging it as the open question for
whoever owns the `gsk hosted deploy` build pipeline. Do not assume it is
a Genspark platform bug without further investigation; it could equally
be an artifact of how this specific project's build config
(`@hono/vite-build/cloudflare-pages`, `execSync` at Vite `define` time)
interacts with that pipeline's checkout strategy.

## Corroborating content-identity evidence (why we believe 566328b did ship)

1. `/api/version`'s `expected_migrations` array (built from
   `readdirSync('migrations/')` at the same build-time `define` step) is
   **byte-identical** (`diff` exit 0) to the local repo's `migrations/`
   directory listing, including `0076_naijastay_live_status_and_demo_label_cleanup.sql`
   and excluding `0075_*` (which does not exist on this branch).
2. `public/static/aura.js` — MD5 identical between the deployed asset
   (`curl https://naijadeals.com/static/aura.js`) and the local repo file:
   `6228419d2dc9248d0383fc86cafa3670` on both sides. The deploy log
   explicitly shows this file was newly uploaded
   (`+ /static/aura.js ... Uploaded 1 of 1 asset`), confirming it's not a
   stale cached copy.
3. `/ecosystem` page HTML shows the exact copy introduced by `566328b`
   ("Explore NaijaGigs" / "Explore NaijaStay" / "Open Aura" CTAs on live
   verticals vs. "Preview {name}" on non-live ones) — this wording does
   not exist in any commit prior to `566328b`.
4. Live functional test: a real service request was created end-to-end
   against production (`POST /api/service-requests` → `id=2`,
   `request_number=SR-MUBZWT1X-185`) and persisted correctly on
   `GET /api/service-requests`.
5. `ecosystem_verticals` table (D1, verified via `gsk hosted d1_query`)
   shows exactly the migration-0076 result: `gigs=live, stay=live,
   aura=live`, all others unchanged.

## Recommended fix directions (for triage, not yet implemented)

- Have `gsk hosted deploy`'s server-side build environment either (a)
  clone the exact pushed commit with full git history preserved rather
  than a synthetic/shallow snapshot, or (b) pass the known source commit
  SHA (already known to the deploy orchestrator, since it operates on a
  specific branch/commit) directly into the build as an environment
  variable instead of relying on `execSync('git rev-parse HEAD')` inside
  a checkout whose provenance isn't guaranteed to match.
- Alternatively, have `vite.config.ts`'s `getBuildGitSha()` prefer a
  `GIT_SHA` / `CF_PAGES_COMMIT_SHA`-style env var when present (common
  pattern for CI/CD pipelines that don't guarantee a full `.git` checkout),
  falling back to `execSync` only for local/manual builds.
- Until fixed, treat `/api/version.git_sha` as **advisory only** for
  deploys made via `gsk hosted deploy`; corroborate with the content
  fingerprints above (migrations list diff, static asset checksums, or a
  live functional smoke test) before certifying deployment identity.

## Decision on this occurrence (Workstream C, 2026-09-22)

Per Pat's explicit decision: the production deployment is accepted as
**functionally correct** based on the corroborating content evidence
above. The exact-SHA identity gate (`LOCAL SHA == REMOTE SHA == DEPLOYED SHA`)
is recorded as **NOT PASSED** and remains open as this ticket, rather than
being silently converted to a PASS. This ticket is the tracking artifact
for that open item.
