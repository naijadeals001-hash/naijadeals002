import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'

const FAQS = [
  {
    q: 'How does escrow protection work?',
    a: 'When you pay for an order — whether by wallet, card or bank transfer — your money is held securely in escrow. It is only released to the vendor once you confirm that you have received your item in good condition. If there is a problem, you can raise a dispute before releasing payment.'
  },
  {
    q: 'What payment methods can I use?',
    a: 'You can pay from your NaijaDeals Wallet, or by card / bank transfer via Paystack. You can top up your wallet at any time from the Wallet page.'
  },
  {
    q: 'How long does delivery take?',
    a: 'Delivery times depend on the vendor and your location, but most orders within Lagos arrive within 2-5 business days, and other states within 5-10 business days. You can track your order status from the Orders page.'
  },
  {
    q: 'Can I return an item?',
    a: 'Yes. Most products carry a 7-day return window if the item arrives damaged, faulty, or not as described. Check the specific return policy on the product page before purchasing.'
  },
  {
    q: 'Is my payment information safe?',
    a: 'Yes. We never store your card details. All card and bank transfer payments are processed directly by Paystack, a licensed and PCI-DSS compliant payment processor.'
  },
  {
    q: 'When will NaijaEats, NaijaGigs and NaijaStay launch?',
    a: 'We are actively building out the rest of the NaijaDeals ecosystem. Subscribe to our newsletter or visit the Ecosystem page to get notified the moment each service goes live in your city.'
  },
  {
    q: 'How do I become a vendor on NaijaDeals?',
    a: 'Vendor self-onboarding is coming in a future release. If you would like early access as a launch vendor, please reach out via the contact details below.'
  }
]

export async function helpPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')

  return c.render(
    <Layout title="Help & Support" user={user} locale={locale}>
      <div class="max-w-3xl mx-auto px-6 lg:px-8 py-10">
        <div class="text-center mb-10">
          <span class="material-symbols-outlined text-4xl text-primary">support_agent</span>
          <h1 class="text-2xl font-bold text-gray-800 mt-2">How can we help?</h1>
          <p class="text-sm text-gray-500 mt-1">Frequently asked questions about shopping, payments and delivery on NaijaDeals.</p>
        </div>

        <div class="space-y-3">
          {FAQS.map((item, i) => (
            <details class="group bg-white border border-gray-200 rounded-xl px-5 py-4">
              <summary class="flex items-center justify-between cursor-pointer list-none font-medium text-gray-800 text-sm">
                {item.q}
                <span class="material-symbols-outlined text-gray-400 group-open:rotate-180 transition-transform">expand_more</span>
              </summary>
              <p class="text-sm text-gray-600 mt-3 leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>

        <div class="mt-10 bg-primary-light rounded-xl p-6 text-center">
          <h3 class="font-bold text-primary-dark">Still need help?</h3>
          <p class="text-sm text-gray-600 mt-1 mb-4">Our customer service team is here for you.</p>
          <a href="mailto:support@naijadeals.com" class="inline-flex items-center gap-2 bg-primary text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition">
            <span class="material-symbols-outlined text-base">mail</span>
            support@naijadeals.com
          </a>
        </div>
      </div>
    </Layout>
  )
}
