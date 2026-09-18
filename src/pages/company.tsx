import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'

/**
 * Company / Legal pages — Unit 5A (Footer & Navigation Truth Pass, Pat's
 * directive 2026-09-18).
 *
 * WHY THIS FILE EXISTS: the footer's "Get to Know Us" and "Policies" columns
 * previously pointed several distinct links (About, Careers, Privacy Policy,
 * Terms of Service, Seller Terms, Payment Terms) all to the SAME /help FAQ
 * page, and Careers pointed to /admin — an internal Control Center route
 * never meant to be customer-facing. Per Pat's explicit "do not create fake
 * links" rule, this file provides one genuine, minimal page per real
 * destination instead.
 *
 * HONESTY RULES ENFORCED IN EVERY PAGE BELOW (per Pat's directive):
 *   - No fabricated company history, offices, employee counts, funding,
 *     investors, awards, or partnerships.
 *   - No invented job openings on the Careers page.
 *   - Legal pages (/terms, /privacy, /seller-terms) are explicitly labeled
 *     as an initial product/legal draft, not a substitute for counsel-
 *     reviewed legal text — structured so counsel can expand them later
 *     without a site redesign.
 *   - No claims about services that do not exist (e.g. NaijaEats/Gigs/Stay
 *     are described exactly as "in development" / "coming soon", matching
 *     ecosystem_verticals' real status — never described as live).
 *
 * Payment Terms is DELIBERATELY not a page here — see Pat's directive:
 * "Only create /payment-terms if the application actually has sufficient
 * payment/legal functionality to justify the page." This app's real payment
 * surface today is Paystack (card, currently unconfigured in production —
 * no PAYSTACK_SECRET_KEY secret set) + the internal Wallet. There is no
 * distinct payment-specific legal content beyond what /terms already
 * covers, so the footer's "Payment Terms" link is mapped to /terms with an
 * in-page anchor/section rather than a fabricated standalone policy — see
 * the DECISIONS.md-style note in Layout.tsx's footer comment for the
 * rationale, kept alongside the link itself.
 */

export async function aboutPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')

  return c.render(
    <Layout title="About NaijaDeals" user={user} locale={locale} description="NaijaDeals is an Africa-first digital commerce ecosystem, starting with NaijaShop — an escrow-protected online marketplace built for Nigeria.">
      <div class="max-w-3xl mx-auto px-6 lg:px-8 py-10">
        <div class="text-center mb-10">
          <span class="material-symbols-outlined text-4xl text-primary">public</span>
          <h1 class="text-2xl font-bold text-gray-800 mt-2">About NaijaDeals</h1>
        </div>

        <div class="space-y-6 text-sm text-gray-700 leading-relaxed">
          <section>
            <h2 class="text-lg font-bold text-gray-900 mb-2">What NaijaDeals is</h2>
            <p>
              NaijaDeals is an Africa-first digital commerce ecosystem. Our first and currently
              live service is <strong>NaijaShop</strong> — an escrow-protected online marketplace
              where verified vendors across Nigeria sell directly to shoppers nationwide, with
              secure wallet and card payments and nationwide delivery.
            </p>
          </section>

          <section>
            <h2 class="text-lg font-bold text-gray-900 mb-2">The wider ecosystem</h2>
            <p>
              Beyond NaijaShop, we are building out a wider ecosystem under one shared NaijaDeals
              account — including NaijaFresh, NaijaEats, NaijaGigs, NaijaStay, NaijaDrive,
              NaijaSend, NaijaStream and Aura AI. These services are at different stages of
              development; the current state of each is always shown honestly on our{' '}
              <a href="/ecosystem" class="text-primary font-medium hover:underline">Ecosystem</a> page,
              where you can also join the waitlist to be notified as each one launches.
            </p>
          </section>

          <section>
            <h2 class="text-lg font-bold text-gray-900 mb-2">Our approach</h2>
            <p>
              We would rather ship a smaller number of things that genuinely work than present a
              long list of features that don't. If a service on NaijaDeals is described as "coming
              soon," it means exactly that — no fabricated listings, no fake reviews, no invented
              statistics anywhere on this platform.
            </p>
          </section>

          <section>
            <h2 class="text-lg font-bold text-gray-900 mb-2">Get in touch</h2>
            <p>
              Questions about NaijaDeals? Reach our team at{' '}
              <a href="mailto:support@naijadeals.com" class="text-primary font-medium hover:underline">support@naijadeals.com</a>,
              or visit our <a href="/help" class="text-primary font-medium hover:underline">Help Center</a>.
            </p>
          </section>
        </div>
      </div>
    </Layout>
  )
}

export async function careersPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')

  // No open positions are currently published anywhere in this codebase/DB —
  // stating that honestly rather than inventing listings, per Pat's explicit
  // "Do not invent open positions" instruction.
  return c.render(
    <Layout title="Careers" user={user} locale={locale} description="Careers at NaijaDeals — an Africa-first digital commerce ecosystem.">
      <div class="max-w-3xl mx-auto px-6 lg:px-8 py-10">
        <div class="text-center mb-10">
          <span class="material-symbols-outlined text-4xl text-primary">work</span>
          <h1 class="text-2xl font-bold text-gray-800 mt-2">Careers at NaijaDeals</h1>
        </div>

        <div class="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <span class="material-symbols-outlined text-3xl text-gray-400">inbox</span>
          <h2 class="font-bold text-gray-800 mt-3">No current listed openings</h2>
          <p class="text-sm text-gray-500 mt-2 max-w-md mx-auto">
            We don't have any open positions published at this time. As NaijaDeals and the wider
            ecosystem grow, roles will be listed here — check back, or reach out below if you'd
            like to be considered for future opportunities.
          </p>
          <a href="mailto:careers@naijadeals.com" class="inline-flex items-center gap-2 bg-primary text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition mt-5">
            <span class="material-symbols-outlined text-base">mail</span>
            careers@naijadeals.com
          </a>
        </div>
      </div>
    </Layout>
  )
}

/** Shared wrapper for the three legal drafts below — identical structure, different content. */
function LegalPageShell({ title, icon, lastUpdated, children }: { title: string; icon: string; lastUpdated: string; children: any }) {
  return (
    <div class="max-w-3xl mx-auto px-6 lg:px-8 py-10">
      <div class="text-center mb-6">
        <span class="material-symbols-outlined text-4xl text-primary">{icon}</span>
        <h1 class="text-2xl font-bold text-gray-800 mt-2">{title}</h1>
        <p class="text-xs text-gray-400 mt-1">Last updated: {lastUpdated}</p>
      </div>

      <div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-8">
        <strong>Initial draft notice:</strong> this page is an initial product/legal draft prepared
        for launch. It is not a substitute for review by qualified legal counsel, and may be
        expanded or revised as NaijaDeals grows.
      </div>

      <div class="space-y-6 text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  )
}

export async function termsPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')

  return c.render(
    <Layout title="Terms of Service" user={user} locale={locale} description="NaijaDeals Terms of Service.">
      <LegalPageShell title="Terms of Service" icon="gavel" lastUpdated="September 2026">
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">1. Acceptance of terms</h2>
          <p>By creating an account or using NaijaDeals, you agree to these Terms of Service. If you do not agree, please do not use the platform.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">2. What NaijaDeals is</h2>
          <p>NaijaDeals operates NaijaShop, an online marketplace connecting independent vendors with shoppers. NaijaDeals is not the seller of record for vendor-listed products; each vendor is responsible for the accuracy, quality, and fulfillment of their own listings, subject to our Buyer Protection and escrow process described in the <a href="/help" class="text-primary font-medium hover:underline">Help Center</a>.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">3. Accounts</h2>
          <p>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You must provide accurate information when registering.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">4. Orders, payments &amp; escrow</h2>
          <p>Payments made on NaijaDeals — whether from your NaijaDeals Wallet or by card/bank transfer — are held in escrow and released to the vendor only once you confirm satisfactory receipt of your order, or as otherwise described in our order and dispute process.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">5. Prohibited conduct</h2>
          <p>You agree not to misuse the platform, including by listing prohibited items, engaging in fraudulent transactions, or attempting to circumvent our payment or moderation systems.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">6. Vendors &amp; service providers</h2>
          <p>Vendors selling on NaijaShop, and providers of any other NaijaDeals ecosystem service as it becomes available, are additionally bound by our <a href="/seller-terms" class="text-primary font-medium hover:underline">Seller Terms</a>.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">7. Changes to these terms</h2>
          <p>We may update these Terms of Service from time to time as the platform evolves. Continued use of NaijaDeals after an update constitutes acceptance of the revised terms.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">8. Contact</h2>
          <p>Questions about these terms can be sent to <a href="mailto:support@naijadeals.com" class="text-primary font-medium hover:underline">support@naijadeals.com</a>.</p>
        </section>
      </LegalPageShell>
    </Layout>
  )
}

export async function privacyPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')

  return c.render(
    <Layout title="Privacy Policy" user={user} locale={locale} description="NaijaDeals Privacy Policy.">
      <LegalPageShell title="Privacy Policy" icon="privacy_tip" lastUpdated="September 2026">
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">1. Information we collect</h2>
          <p>We collect information you provide directly (such as your name, email, phone number, and delivery addresses) and information generated by your use of the platform (such as orders, wishlist items, and browsing activity used to personalize your experience).</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">2. How we use your information</h2>
          <p>We use your information to operate the marketplace — processing orders and payments, coordinating delivery, providing customer support, personalizing recommendations, and communicating important account or order updates.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">3. Payments</h2>
          <p>Card and bank transfer payments are processed by our licensed payment partner, Paystack. NaijaDeals never stores your full card details.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">4. Marketing communications &amp; newsletter</h2>
          <p>If you subscribe to our newsletter or opt in to marketing communications, we will use your email solely for that purpose. You may withdraw consent and unsubscribe at any time via the link included in every email we send, or by contacting us directly.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">5. Sharing of information</h2>
          <p>We share information with vendors as necessary to fulfill your orders (e.g. delivery address, order contents), and with service providers who help us operate the platform (e.g. our payment processor). We do not sell your personal information.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">6. Your choices</h2>
          <p>You can review and update your account information at any time from your <a href="/account" class="text-primary font-medium hover:underline">Account</a> page, and manage notification preferences there as well.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">7. Contact</h2>
          <p>Privacy questions can be sent to <a href="mailto:support@naijadeals.com" class="text-primary font-medium hover:underline">support@naijadeals.com</a>.</p>
        </section>
      </LegalPageShell>
    </Layout>
  )
}

export async function sellerTermsPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')

  return c.render(
    <Layout title="Seller Terms" user={user} locale={locale} description="NaijaDeals Seller / Vendor Terms.">
      <LegalPageShell title="Seller Terms" icon="storefront" lastUpdated="September 2026">
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">1. Scope</h2>
          <p>These Seller Terms apply to every vendor operating a store on NaijaShop, in addition to our general <a href="/terms" class="text-primary font-medium hover:underline">Terms of Service</a>.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">2. Listings</h2>
          <p>You are responsible for the accuracy of every listing you publish — including pricing, stock levels, product condition, and delivery timelines. Listings are subject to our moderation process and may be paused, rejected, or removed if they violate platform policy.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">3. Fulfillment &amp; delivery</h2>
          <p>You agree to fulfill orders within the delivery window stated on your listing, and to communicate promptly with buyers regarding any delay.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">4. Payments &amp; payouts</h2>
          <p>Buyer payments are held in escrow and released to your seller finance balance once the buyer confirms receipt, or per our standard order-completion timeline. You are responsible for keeping your payout bank details accurate and up to date.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">5. Verification</h2>
          <p>NaijaDeals may require identity or business verification before or during your time as a seller, and may suspend a store pending review of a report or dispute.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">6. Prohibited items &amp; conduct</h2>
          <p>You may not list prohibited, counterfeit, or illegal goods, misrepresent product condition or origin, or attempt to conduct transactions outside of the platform's payment and escrow system.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">7. Termination</h2>
          <p>NaijaDeals may suspend or terminate a seller account for violation of these terms, repeated buyer disputes, or fraudulent activity.</p>
        </section>
        <section>
          <h2 class="text-base font-bold text-gray-900 mb-2">8. Contact</h2>
          <p>Seller support questions can be sent to <a href="mailto:support@naijadeals.com" class="text-primary font-medium hover:underline">support@naijadeals.com</a>.</p>
        </section>
      </LegalPageShell>
    </Layout>
  )
}
