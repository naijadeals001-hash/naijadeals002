# NaijaDeals Production Recovery Index

## Purpose

This document records the authoritative recovery and audit artifacts
for the NaijaDeals production environment and explains the relationship
between the GitHub source repository and the currently deployed
production application.

## Repository

Repository:
naijadeals001-hash/naijadeals002

Current GitHub checkpoint:
3c4f50f0bd95bf3748e98ca38bba9226023c0342

## Production

Production URL:
https://naijadeals.com

Production application SHA:
99b1664df552ce1cd707330e17207d8869f12a4e

Production migration count:
36

Local migration count at audit:
12

## Critical Architecture Finding

The production application is materially ahead of the current
GitHub source tree.

The production database schema and live application behavior have
been confirmed, but the original production application source code
that produced the deployed production SHA has not been recovered.

Therefore:

- production MUST NOT be overwritten by the current repository
- the production database MUST NOT be rebuilt from the current
  12-migration repository
- production functionality MUST NOT be reconstructed blindly
- the live production application is currently the functional
  reference implementation
- the recovered production schema is the database contract
- future reconstruction must be schema-first and route/API-first

## Recovery Documents

1. NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md
   - Documents the source-code recovery investigation.
   - Documents the recovered production schema.
   - Documents where the missing production source was searched.

2. NAIJADEALS-LIVE-PRODUCTION-AUDIT.md
   - Documents direct live-site verification.
   - Confirms that the production functionality represented by the
     recovered schema is actually live.
   - Records vertical/API status.

## Production Safety Rule

Until production source reconciliation is complete:

NO PRODUCTION DEPLOYMENT from the current main branch.

NO rebuild_db.

NO destructive production migration.

NO replacement of production application code.

NO assumption that the current GitHub source is production-equivalent.

## Recovery Status

Schema:
RECOVERED

Live application behavior:
CONFIRMED

Original production source:
NOT RECOVERED

GitHub repository:
SAFE / SYNCHRONIZED

Production:
DO NOT OVERWRITE

## Next Phase

The next phase, when explicitly authorized, is:

Production Functional Specification Recovery

That phase should extract the live production application's routes,
APIs, authentication requirements, UI behavior, state transitions,
and database relationships so the missing source can be reconstructed
locally without inventing competing implementations.

NO IMPLEMENTATION IS AUTHORIZED BY THIS DOCUMENT.
