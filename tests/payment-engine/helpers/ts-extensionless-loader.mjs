/**
 * Payment Engine — Unit 4 test-harness-only ESM loader hook.
 *
 * WHY THIS EXISTS: src/lib/orders.ts imports sibling modules with
 * extensionless specifiers (`import { debitWallet } from './wallet'`),
 * which is valid/required for the project's Vite/Cloudflare bundler but is
 * NOT resolvable by Node's native ESM loader when running orders.ts
 * directly under `--experimental-strip-types` (Node's own resolver
 * requires an explicit extension on relative specifiers — it does not
 * guess `.ts`). Unit 2's wallet.ts had no such internal relative imports,
 * so this gap never surfaced until Unit 4 needed to import orders.ts
 * directly. This is a TEST-ONLY resolution shim — it does not change any
 * application source file's import style (which must stay extensionless
 * for Vite) and has zero effect on the production build.
 *
 * Registered via `node --import` in the Unit 4 test's run command. Only
 * intervenes when Node's default resolver fails AND the specifier has no
 * file extension — tries `.ts` then `.tsx` then `.js` before giving up, so
 * unrelated resolution failures still surface as real errors.
 */
import { register } from 'node:module'

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier)
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
    if (hasExtension || !isRelative) throw err

    for (const ext of ['.ts', '.tsx', '.js']) {
      try {
        return await nextResolve(specifier + ext, context)
      } catch (_) {
        // try next extension
      }
    }
    throw err
  }
}
