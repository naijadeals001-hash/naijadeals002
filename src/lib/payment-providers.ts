import type { PaymentStatus } from './payment-engine'

export type PaymentProviderName = 'paystack' | 'wallet' | 'sandbox'

export interface ProviderPaymentRequest {
  reference: string
  amountMinor: number
  currency: string
  customerEmail?: string | null
  callbackUrl?: string
}

export interface ProviderPaymentResult {
  provider: PaymentProviderName
  providerReference: string
  status: PaymentStatus
  authorizationUrl?: string
  raw?: unknown
}

export interface PaymentProviderAdapter {
  readonly name: PaymentProviderName
  initialize(input: ProviderPaymentRequest): Promise<ProviderPaymentResult>
  verify(providerReference: string): Promise<ProviderPaymentResult>
}

/** Registry boundary. Live adapters are registered by the runtime; absent
 * credentials must result in an unavailable response, never a fake success. */
export class PaymentProviderRegistry {
  private readonly adapters = new Map<PaymentProviderName, PaymentProviderAdapter>()

  register(adapter: PaymentProviderAdapter): void { this.adapters.set(adapter.name, adapter) }

  get(name: PaymentProviderName): PaymentProviderAdapter {
    const adapter = this.adapters.get(name)
    if (!adapter) throw new Error(`Payment provider '${name}' is not configured`)
    return adapter
  }

  has(name: PaymentProviderName): boolean { return this.adapters.has(name) }
}
