/** Canonical hostname reserved for the central NaijaDeals administration entry point. */
export const ADMIN_CANONICAL_HOST = 'admin.naijadeals.com'
export const ADMIN_PATH_ENTRY = '/control-center/login'

export function normalizeHost(host: string | undefined): string {
  return (host ?? '').split(':', 1)[0].trim().toLowerCase()
}

export function isCanonicalAdminHost(host: string | undefined): boolean {
  return normalizeHost(host) === ADMIN_CANONICAL_HOST
}
