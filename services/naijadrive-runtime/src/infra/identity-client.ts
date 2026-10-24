import type { RuntimeConfig } from '../config/runtime-config.js'

export interface NaijaDealUser {
  id: number
  email: string | null
  phone: string | null
  name: string
  role: string
  status: string
  permissions: string[]
  driverProfileId?: number | null
  driverStatus?: string | null
}

export class NaijaDealIdentityClient {
  constructor(private readonly config: RuntimeConfig) {}

  async introspect(sessionToken: string): Promise<NaijaDealUser | null> {
    const response = await fetch(`${this.config.naijaDealIdentityUrl}/api/auth/introspect`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'x-naijadeal-service-token': this.config.naijaDealServiceToken,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })
    if (response.status === 401 || response.status === 403) return null
    if (!response.ok) throw new Error(`NaijaDeal identity introspection failed with HTTP ${response.status}`)
    const body = await response.json() as { user?: NaijaDealUser | null }
    return body.user ?? null
  }
}
