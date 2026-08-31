// Ambient declarations for the build-time constants injected by vite.config.ts's
// `define` block (esbuild/Rollup dead-code-eliminates these into literal strings —
// they do not exist as real variables/imports anywhere, so TypeScript needs to be
// told they exist as globals). See vite.config.ts for how the values are computed
// and src/routes/version.ts for where they're read at runtime.
declare const __GIT_SHA__: string
declare const __BUILD_TIME__: string
declare const __EXPECTED_MIGRATIONS__: string[]
