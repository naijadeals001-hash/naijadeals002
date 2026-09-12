# NaijaDeals Permanent Engineering Rule: Committed + Pushed + Remote-Verified

**Status: ACTIVE — applies to every NaijaDeals workstream (NaijaSend, NaijaDrive,
NaijaFresh, NaijaEats, NaijaStay, ecosystem/core) and every future session,
sandbox, or agent working on this repo.**

**Adopted:** 2026-09-12, after a sandbox loss destroyed an entire in-progress
Lifecycle-A implementation (driver assignment + shipment operations) that had
never been pushed to GitHub. Local commits inside a sandbox are not durable —
sandboxes can be reset, replaced, or reseeded from an older GitHub state at
any time with no warning. Only the GitHub remote survives that.

## The rule

> A change is not safe until it is **committed AND pushed AND verified present
> on the remote**. "It's committed locally" is not a safe state. Treat it as
> equivalent to unsaved work.

## Standard workflow for every meaningful change

```
Make change
   ↓
Run quick sanity check (build / typecheck / curl smoke test — whatever is cheap)
   ↓
git status                      (confirm exactly the intended files changed)
   ↓
git add <intended files>        (never blind `git add -A` without reading status first)
   ↓
git commit -m "<descriptive message>"
   ↓
git push origin main
   ↓
VERIFY remote commit exists:
   git ls-remote origin main
   (or) gh api repos/<owner>/<repo>/commits/main -q '.sha'
   → compare returned SHA to `git rev-parse HEAD` — they must match
   ↓
Continue working
```

**Never consider a task step "done" until the push-and-verify step has
actually run and matched.** Silently assuming a push succeeded is how a
sandbox loss becomes unrecoverable.

## Checkpoint before risky work

Before starting any of the following, create a **known-good GitHub
checkpoint** first — commit + push + verify + record it — so there is always
a clean rollback point:

- A new major vertical (NaijaDrive, NaijaStay, etc.)
- A Lifecycle phase on an existing vertical (e.g. NaijaSend Lifecycle-A/B/C)
- Database schema migrations
- Large UI redesigns
- Architecture changes (routing, auth, data model refactors)
- Automated seed scripts or bulk data operations

Record the checkpoint in this format (in the PR/commit description, in chat,
or appended to this file's Checkpoint Log below):

```
CHECKPOINT:
NaijaDeals — Before <workstream>
commit: <full sha>
pushed: YES
remote verified: YES  (ls-remote SHA matches local HEAD)
```

## Tags for major milestones

Use annotated git tags for durable, human-findable recovery points — tags
survive better in memory/conversation than raw hashes:

```
naijadeals-baseline
naijafresh-live
naijaeats-live
naijastay-foundation
naijasend-marketplace-live
naijasend-browser-verified
naijasend-lifecycle-a-live
naijadrive-foundation
```

Create with:
```bash
git tag -a <tag-name> -m "<what this checkpoint represents>"
git push origin <tag-name>
```
Verify with:
```bash
git ls-remote --tags origin | grep <tag-name>
```

## Never, while recovery status is uncertain

- `git reset --hard`
- `git rebase`
- `git push --force` / `git push -f`
- Deleting branches
- Overwriting a working tree with a fresh clone

on a branch whose remote-pushed state hasn't just been freshly confirmed.

## If a sandbox ever turns out to be the wrong clone / missing expected work

**STOP → preserve current state (do not reset/discard anything) → locate the
correct GitHub branch/commit/tag → verify it against what's expected → only
then continue.** Do not silently rebuild from memory and pass it off as
equivalent — say so explicitly and get confirmation on how to proceed.

## Checkpoint Log

| Date | Checkpoint | Commit | Pushed | Remote Verified | Tag |
|---|---|---|---|---|---|
| 2026-09-12 | NaijaDeals — SOP adoption (this doc + .gitignore fix) | `bd43c0f` | YES | YES (git ls-remote + gh api, both matched local HEAD) | `naijadeals-sop-checkpoint-2026-09-12` |
| 2026-09-02 | Prior verified tip before the sandbox-loss incident (no tag exists for this — lesson learned) | `b1fb48f` | YES | — | none |
