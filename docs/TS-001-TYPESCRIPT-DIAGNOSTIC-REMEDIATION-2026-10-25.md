# NaijaDeals TS-001 — TypeScript Diagnostic Remediation

## Scope

TS-001 started from commit `210ad1c5b533d5c4f73e577956c773dda7d64e3c` on `feat/naijadrive-private-ride-foundation`. The worktree was clean except for the intentionally preserved untracked `.npm-cache-rea/` directory. No production deployment, remote D1 mutation, DNS change, reset, clean, stash, rebase, force-push, or Three.js redesign rollback was performed.

The TypeScript quality gate used the existing strict root configuration and `scripts/tsc-baseline-gate.mjs`; no files were excluded and no baseline snapshot was rewritten.

## Starting evidence

| Check | Result |
|---|---|
| Repository | `https://github.com/naijadeals001-hash/naijadeals002.git` |
| Branch | `feat/naijadrive-private-ride-foundation` |
| Starting local SHA | `210ad1c5b533d5c4f73e577956c773dda7d64e3c` |
| Starting remote SHA | `210ad1c5b533d5c4f73e577956c773dda7d64e3c` |
| TypeScript | `5.9.3` |
| Compiler settings | `strict: true`, `skipLibCheck: true`, bundler resolution retained |
| Baseline diagnostics | 9 |
| Current diagnostics before TS-001 | 34 |
| Newly surfaced diagnostics | 25 |
| Complete raw compiler output | Captured in `/tmp/ts001-tsc-raw-20261025.txt` during the session |
| Existing gate output | Captured in `/tmp/ts001-ts-baseline-20261025.txt` |
| REA | `rea-agents@6.7.0`; MCP registration preserved and verified. REA was not needed because this task was local compiler/type-contract remediation and involved no external library behavior. |

The 34 messages were not 34 independent root causes. The first cluster was one root configuration issue affecting the separately configured NestJS service; the remaining messages were application type-contract defects.

## Source-backed inventory and fixes

### 1. NaijaDrive decorators — 13 reported messages, one configuration cause

**Files:**

- `services/naijadrive-runtime/src/http/driver-presence.controller.ts`
- `services/naijadrive-runtime/src/http/health.controller.ts`
- `services/naijadrive-runtime/src/http/ride.controller.ts`
- `services/naijadrive-runtime/src/http/ride.gateway.ts`

**Reported codes:** `TS1206`, `TS1240`, `TS1241`, `TS1270`.

The service has its own `services/naijadrive-runtime/tsconfig.json` with legacy decorator support and independently typechecks successfully. The root compiler was also discovering those service files but did not carry the service's `experimentalDecorators` and `emitDecoratorMetadata` settings. That produced decorator signature and parameter/property decorator errors even though the service compiler passed.

**Fix:** added the same decorator compiler options to the root `tsconfig.json`. This is not a strictness reduction and does not exclude the service from checking; it makes the root compiler agree with the service's declared NestJS decorator model.

**Verification:** standalone service typecheck passed before the fix, root typecheck passed after the fix, and the application build passed.

### 2. JSX numeric attributes — 2 reported messages

**Files:**

- `src/pages/auth.tsx:158`
- `src/pages/send.tsx` on the single-line freight form

**Reported code:** `TS2322: Type 'string' is not assignable to type 'number'.`

Hono JSX types numeric HTML attributes as numbers. The affected `minlength`, `rows`, `min`, and `step` attributes were string literals.

**Fix:** changed them to numeric JSX expressions (`minLength={8}`, `rows={2}`, `min={0.1}`, `step={0.1}`). No form behavior or validation requirement was removed.

### 3. Renderer return contract — 1 reported message

**File:** `src/renderer.tsx:6`

**Reported code:** `TS2345`, where the pass-through renderer could return an unwrapped `Child` union containing `undefined` and other values outside the renderer component result contract.

**Fix:** return a JSX fragment (`<>${'{'}children${'}'}</>`) so the renderer always returns a valid JSX component result while preserving the pass-through document behavior.

### 4. Booking availability and rollout narrowing — 4 reported messages

**File:** `src/routes/api-bookings.ts:118,134,350,397`.

**Reported code:** `TS2345` for possibly undefined query timestamps and nullable listing fields passed to functions requiring strings.

**Source evidence:** `isValidBookingWindow` validates the timestamp values but originally did not narrow them for TypeScript. The listing model permits nullable `vertical` and `country_iso` values.

**Fix:** handlers now explicitly require `starts_at` and `ends_at` before calling availability/capacity functions, reject listings without a configured vertical, and normalize the country code to a concrete string before the rollout guard. This preserves the existing 400/409 validation boundaries and does not bypass rollout enforcement.

### 5. Cart preview JSON failure contract — 7 reported messages

**File:** `src/routes/api-cart.ts:125-140`.

**Reported code:** `TS2339` for `buy_now`, `delivery_method`, and `coupon_code` on a union with `{}`.

**Root cause:** malformed JSON was converted to `{}`, creating a union that did not guarantee the typed request fields existed.

**Fix:** malformed JSON now returns the existing-style 400 JSON error instead of entering business logic. Valid bodies retain the same optional field semantics and calculations.

### 6. Catalog listing contract — 4 reported messages

**File:** `src/routes/api-catalog.ts:314-345`.

**Reported code:** `TS2339` for `.results` on values returned by `getListingsForProduct` and `getVariantsForListing`.

**Root cause:** both helpers return arrays, not D1 result envelopes. The route incorrectly treated them as `{ results }` objects.

**Fix:** use array operations and return the arrays directly. The D1 query results for reviews, questions, and related products remain envelope-based and unchanged.

### 7. Control Center route parameters and audit snapshots — 13 reported messages

**File:** `src/routes/api-control-center.ts` and `src/routes/api-control-center-naijapay.ts`.

**Reported codes:** `TS2532`, `TS2322`, `TS2345`.

**Root causes:** Hono route parameters are typed as possibly absent; D1 `.first()` results are nullable; and audit snapshots intentionally use null to represent absent before/after state. NaijaPay provider lookups passed an un-narrowed provider key.

**Fixes:**

- Added explicit required parameter checks for vertical slugs, country/city/vertical route segments, country ISO routes, development task keys, and NaijaPay provider keys.
- Passed narrowed parameter values to lookup/update helpers.
- Broadened the internal `ControlCenterAuditEntry` before/after snapshot types to accept `Record<string, unknown> | null`, matching the existing JSON serialization semantics rather than forcing fake empty objects.

RBAC, country scope checks, city enforcement, audit writes, and payment provider prerequisites remain unchanged.

### 8. Courier context typing — 2 reported messages

**File:** `src/routes/api-eats-courier.ts:59,64`.

**Reported code:** `TS2347: Untyped function calls may not accept type arguments.`

**Root cause:** helper functions accepted `any` Hono contexts, so typed `c.req.json<T>()` calls were not valid under strict checking.

**Fix:** added the existing `driverProfile` to `AppEnv`, typed courier helpers as `Context<AppEnv>`, and retained the server-resolved `DriverProfileRow` source populated by `requireActiveDriver`. No client-supplied driver identity was introduced.

### 9. Eats shipping country — 1 reported message

**File:** `src/routes/api-eats.ts:165` and `src/lib/eats-cart.ts`.

**Reported code:** `TS2339: Property 'country' does not exist on type 'EatsShippingDetails'.`

**Root cause:** checkout already passed country to the rollout guard conceptually, but the shipping contract omitted it.

**Fix:** added optional `country` to `EatsShippingDetails`; saved addresses use their persisted country with `NG` as the existing default, while direct checkout input may provide a country and otherwise uses `NG`. This preserves country-aware rollout enforcement instead of suppressing the diagnostic.

### 10. NaijaPay amount narrowing — 2 reported messages

**File:** `src/routes/api-naijapay.ts:72,75`.

**Reported codes:** `TS18048`, `TS2322`.

**Root cause:** validation used optional chaining and a compound expression, but TypeScript could not prove `amount_minor` remained defined at the payment-intent call.

**Fix:** explicitly reject a missing body and missing amount first, then validate the concrete `amountMinor` value before passing it to `createPaymentIntent`. Idempotency, positive-safe-integer validation, wallet funding, and payment event recording remain unchanged.

## Diagnostic delta

| Stage | Baseline diagnostics | Current diagnostics | New diagnostics | Gate |
|---|---:|---:|---:|---|
| Starting checkpoint | 9 | 34 | 25 | Failed |
| After batch 1 | 9 | 7 | 0 | Not the final gate |
| After batch 2 | 9 | 3 | 0 | Not the final gate |
| Final | 9 | 0 | 0 | Passed |

The final `npm run test:ts-baseline` output was:

```text
TypeScript command exit: 0
Baseline diagnostics: 9
Current diagnostics: 0
New diagnostics: 0
Resolved baseline diagnostics: 9
```

## Verification

- `npm run test:ts-baseline` — passed; 0 current diagnostics.
- `npm run build` — passed; 272 modules.
- `node --check public/static/control-center-3d.js` — passed.
- Integrated CC-003, CC-004, NaijaDrive recovery, EATS courier, EATS operator, carpool, and Shop checkout idempotency matrix — 26 passed, 0 failed.
- Three.js browser suite — passed across 1440×900, 1280×800, 768×1024, and 390×844.
- Three.js acceptance results: reduced motion, forced fallback, context loss, and disposal checks passed; 0 unexpected console errors; 0 failed requests.
- Preview root `/` — HTTP 200 and `Home | NaijaDeals` title.

## Historical D1 errors

The preview log still contains older accumulated messages including `18 values for 17 columns` and wrong parameter bindings. They were not deleted and were not claimed as resolved by a healthy restart. The TS-001 diagnostics did not involve the Development Registry SQL implementation. The registry's prior source repair remains a separate runtime/database concern; the next maintenance task should reproduce any new occurrence with a fresh log boundary and trace the exact SQL path before changing it.

## Registry and release state

- Local Development Registry task `TS-001` was created/updated to `COMPLETE` with the diagnostic delta, build result, test result, browser result, limitations, and verification timestamp.
- The source seeding list in `src/lib/control-center-development.ts` now includes the TS-001 task so a fresh local registry can reproduce the record.
- No production registry or production D1 data was mutated.
- The synchronization ledger is updated in the same repository batch.

## Remaining work

The TypeScript gate is green. Recommended follow-up: create a separate D1 runtime investigation task for the historical binding errors, using fresh PM2/Wrangler log timestamps and a targeted reproduction. Do not mix that SQL investigation into TS-001 unless a new reproduction identifies a direct type or query-contract defect.
