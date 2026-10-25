import type { FC } from 'hono/jsx'

interface UnavailableVerticalStateProps {
  name: string
  status: string
  route?: string
  waitlistId?: string
}

const STATUS_COPY: Record<string, string> = {
  coming_soon: 'This vertical is not open for transactions yet.',
  in_development: 'This vertical is being built and is not open for transactions yet.',
  beta: 'This vertical is in limited beta and some workflows may not be available yet.'
}

/**
 * Shared honesty boundary for registry-backed vertical previews. This component
 * intentionally offers discovery and waitlist actions only; it never renders a
 * fake checkout, booking, payment, ride, order, or request-success state.
 */
export const UnavailableVerticalState: FC<UnavailableVerticalStateProps> = ({ name, status, route = '/ecosystem', waitlistId = 'waitlist-form' }) => (
  <section class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 py-10">
    <div class="rounded-2xl border border-amber-200 bg-amber-50 p-6 md:p-8 text-center">
      <span class="material-symbols-outlined text-4xl text-amber-600">construction</span>
      <h2 class="text-xl font-bold text-gray-900 mt-3">{name} is not available for transactions yet</h2>
      <p class="text-sm text-gray-600 mt-2">{STATUS_COPY[status] || 'This vertical is not available for transactions yet.'}</p>
      <div class="flex flex-col sm:flex-row justify-center gap-3 mt-5">
        <a href={`#${waitlistId}`} class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-white font-semibold px-5 py-3 hover:bg-primary-dark transition">
          <span class="material-symbols-outlined text-lg">notifications_active</span>
          Join the waitlist
        </a>
        <a href={route} class="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-semibold px-5 py-3 hover:border-primary hover:text-primary transition">
          <span class="material-symbols-outlined text-lg">arrow_back</span>
          Back to ecosystem
        </a>
      </div>
    </div>
  </section>
)
