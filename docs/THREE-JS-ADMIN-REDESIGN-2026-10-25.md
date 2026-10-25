# Three.js Admin Redesign — 2026-10-25

## Status

Implemented locally on the existing Control Center overview. No production deployment, production D1 mutation, DNS change, or hosted publish was performed.

## REA availability report

- The repository's recorded REA MCP registration is enabled in `/home/user/.config/opencode/opencode.jsonc` and points to `rea-agents@6.7.0`.
- Direct verification with the inherited npm environment failed because npm tried to read the root-owned shared cache at `/opt/npm-cache` and returned `EACCES`.
- A safe isolated npm user-config/cache override at `/tmp/rea-npmrc` plus the preserved `.npm-cache-rea/` directory succeeded: `rea 6.7.0` and the MCP registration were usable without changing shared ownership or permissions.
- `rea doctor` reported the installation and OpenCode registration aligned, but no browser target/provider was configured for this Linux sandbox; analysis engines such as Hopper/Ghidra/IDA were unavailable. No REA browser/provider observation is claimed.
- Fallback research used the official Three.js documentation/manual search results and local source inspection.

## Verified research observations

1. The official Three.js manual exposes dedicated guidance for responsive design and object disposal. This informed the explicit resize observer, capped pixel ratio, renderer disposal, geometry/material disposal, and animation cancellation.
2. The official `WebGLRenderer` documentation exposes context-loss/restore tooling. This informed the `webglcontextlost` listener and explicit HTML fallback state.
3. The existing Admin already uses a dark charcoal/emerald enterprise visual language, grouped permission-aware navigation, SSR HTML tables, honest unavailable states, and a unified ecosystem registry. The redesign extends those patterns rather than replacing them.

## Architecture assessment

- Framework: Hono JSX SSR + Vite + Cloudflare Pages/Workers.
- Existing auth/RBAC: shared `nd_session`, `requireControlCenterAuth`, `requireControlCenterPermission`, and server-resolved `ControlCenterAccessResolution`.
- Existing data source: `getUnifiedEcosystemRegistry()` from the canonical D1 registry/readiness/capability/development tables.
- Existing preview: PM2 process `naijadeals`, Wrangler Pages dev on port 3000, reused without starting a duplicate process.
- Existing route preserved: `/control-center`; the visualization is an additive section inside the authenticated overview route.
- No API route, D1 migration, data contract, permission, audit path, or business mutation was added.

## Implementation

- `public/static/control-center-3d.js`: lazy progressive-enhancement client module. It loads only after the section enters the viewport, then dynamically imports the local pinned Three.js module. It includes low-power rendering, capped pixel ratio, resize handling, visibility pause, reduced-motion behavior, context-loss fallback, keyboard-usable HTML registry fallback, selection highlighting, and full disposal.
- `public/static/vendor/three.module.min.js` and `public/static/vendor/three.core.min.js`: vendored Three.js `0.180.0` ESM runtime and its local split core module, loaded locally rather than from a third-party CDN.
- `tests/control-center/browser/three-js-control-center-acceptance.mjs`: authorized Playwright browser acceptance, responsive screenshots, forced module-failure fallback, reduced-motion, context-loss, and cleanup checks.
- `qa-screenshots/three-js-control-center/`: browser screenshots, JSON results, and preserved TypeScript gate output.
- `src/routes/control-center.tsx`: adds a topology section backed exclusively by authorized registry data and keeps a visible HTML inspector/fallback.
- `public/static/style.css`: responsive, focus-visible, state indicator, fallback, and reduced-motion styles.
- `package.json` / `package-lock.json`: adds Three.js `0.180.0` for the vendored runtime source.
- `README.md`: records the redesign and evidence document.

## Dependency and license report

- Added dependency: `three@0.180.0`.
- Three.js is open source under the MIT License. The vendored file is sourced directly from the installed package; no paid service, map API, proprietary asset, or recurring subscription was introduced.
- `npm install` reported 8 pre-existing audit findings in the dependency tree (1 moderate, 7 high). No automatic audit fix was run because it could modify unrelated dependencies.

## Verification evidence

Baseline before the redesign:

```text
npm run build
272 modules transformed
_dist worker: 1,383.50 kB; gzip 296.38 kB
```

After the redesign:

```text
npm run build
272 modules transformed
_dist worker: 1,387.89 kB; gzip 297.50 kB
```

The worker increase is approximately 4.39 kB gzip because Three.js is a public static lazy asset and is not bundled into the worker. The vendored ESM assets are `three.module.min.js` (338,908 bytes) and `three.core.min.js` (381,124 bytes); browser evidence confirmed they are requested only when the scene enters view.

Preview source identity before the implementation build:

```text
GET http://localhost:3000/api/version → 200
source_sha = c97a2dbd50a9654eb31f9e511854e88976c04700
in_sync = true
```

Unauthenticated route boundary:

```text
HEAD /control-center → 302 /control-center/login?next=%2Fcontrol-center
```

The focused Control Center/RBAC/HTTP suite passed 5/5 after the visual change. The integrated relevant matrix passed 26/26. Authorized Playwright acceptance passed at 1440×900, 1280×800, 768×1024, and 390×844 with zero unexpected console errors and zero unexpected failed requests. Forced local module failure activated the HTML fallback; reduced-motion, visibility lifecycle, context-loss, and disposal checks passed. Screenshots and JSON evidence are in `qa-screenshots/three-js-control-center/`.

The TypeScript diagnostic-baseline gate remains failing with 25 newly surfaced diagnostics in existing NestJS/runtime and unrelated route files. The redesign adds no TypeScript imports or compiler/configuration changes; the only package change is the MIT Three.js dependency, which is not imported by the TypeScript Worker graph. Full output is preserved in `qa-screenshots/three-js-control-center/ts-baseline.txt`. The gate is reported as failing, not bypassed. Historical PM2 D1 errors remain in accumulated logs and were not deleted.

## Remaining verification

- The TypeScript baseline debt remains an explicit repository-level blocker.
- Full Control Center operational/browser acceptance outside this Three.js overview remains governed by the prior CC-004 evidence and limitations.
- No production deployment or hosted publish was performed.
