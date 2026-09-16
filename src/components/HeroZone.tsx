import type { FC } from 'hono/jsx'
import type { HeroCampaignRow, AuthUser } from '../types'
import type { PersonalizationSnapshot } from '../lib/personalization'
import { formatNaira } from '../lib/money'

/**
 * HeroZone — the approved 3-zone hero composition (Pat's directive,
 * "NAIJADEALS / NAIJASHOP — APPROVED DIRECTION", Checkpoint A).
 *
 * Structural replacement for the old 5-panel HeroCarousel grid. Reference
 * proportions: ~65% primary rotating campaign / ~20% app-download panel /
 * ~15% personalization panel (stacked on the right, since 20+15=35% matches
 * the reference's right column width, split into two stacked cards).
 *
 * ZONE 1 (primary, ~65%): the SAME campaign-rotation engine as before —
 * all 10+ hero_campaigns rows rotate through this ONE fixed slot (never
 * pads to N panels). Reuses HeroCarousel's rotation JS contract exactly
 * (data-hero-slot=0, initHeroGrid() in app.js) so no client script changes
 * are needed here — this component just changes which DOM elements exist
 * around slot 0.
 *
 * ZONE 2 (app promo, ~20% width, upper-right): STATIC, not campaign-driven.
 * No fake app-store URLs are used — NaijaDeals has no published mobile app
 * yet, so the CTA opens the real, functional EcosystemWaitlistModal (same
 * modal used across all 8 planned-vertical preview pages) with the
 * "allServices" service preselected, rather than linking to a dead
 * apps.apple.com/play.google.com URL. The caller (home.tsx) MUST mount
 * <EcosystemWaitlistModal /> once on the page for this trigger to work —
 * see home.tsx. This keeps the panel fully functional per Pat's "not a
 * placeholder" requirement without fabricating a listing that doesn't exist.
 *
 * ZONE 3 (personalization, ~15% width, lower-right): REAL account data via
 * getPersonalizationSnapshot() (wallet balance, wishlist count, order
 * count) — already built in personalization.ts but never wired until now.
 * Logged-out visitors get a non-personalized discovery card instead of
 * fabricated numbers, per Pat's explicit instruction.
 *
 * Mobile (<lg): falls back to the same single-campaign swipeable carousel
 * HeroCarousel already used — a 3-zone desktop composition cannot usefully
 * compress to a 390px screen, and the reference's own mobile pattern
 * (not supplied) is inferred as single-campaign, matching every other
 * carousel section on this page.
 */
export const HeroZone: FC<{
  campaigns: HeroCampaignRow[]
  user: AuthUser | null
  personalization: PersonalizationSnapshot | null
}> = ({ campaigns, user, personalization }) => {
  if (!campaigns || campaigns.length === 0) return null

  const primary = campaigns[0]
  const textLight = primary.theme === 'dark'

  // Compact rotation payload — identical shape/contract to the old HeroCarousel,
  // so app.js's initHeroGrid() works against this single-slot grid unmodified.
  const rotationPayload = campaigns.map((c) => ({
    title: c.title,
    subtitle: c.subtitle,
    image_desktop_url: c.image_desktop_url,
    image_mobile_url: c.image_mobile_url,
    cta_label: c.cta_label,
    cta_href: c.cta_href,
    theme: c.theme
  }))

  return (
    <section id="hero-zone" class="relative bg-gray-100" role="region" aria-label="Featured promotions">
      {/* ============ DESKTOP (lg+): 3-ZONE COMPOSITION, ~65/20/15 ============ */}
      <div class="hidden lg:flex gap-3 lg:h-[420px] xl:h-[460px]">
        {/* ZONE 1 — PRIMARY ROTATING CAMPAIGN (~65%) */}
        <div
          id="hero-grid"
          class="flex-[65] relative"
          data-autoplay-ms="6000"
          data-total={campaigns.length}
          data-campaigns={JSON.stringify(rotationPayload)}
        >
          <a
            href={primary.cta_href}
            class="hero-panel group relative rounded-xl overflow-hidden block h-full w-full bg-gray-200"
            data-hero-slot={0}
            data-role="primary"
          >
            <picture>
              <source data-hero-mobile-src media="(max-width: 767px)" srcset={primary.image_mobile_url} />
              <img
                data-hero-img
                src={primary.image_desktop_url}
                alt=""
                class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                loading="eager"
                fetchpriority="high"
                decoding="async"
                onerror="this.onerror=null;this.removeAttribute('src');this.classList.add('hero-img-failed')"
              />
            </picture>
            <div
              data-hero-overlay
              class={`absolute inset-0 flex items-end pointer-events-none ${
                textLight
                  ? 'bg-gradient-to-t from-black/75 via-black/15 to-transparent'
                  : 'bg-gradient-to-t from-white/80 via-white/25 to-transparent'
              }`}
            >
              <div class="p-5 md:p-7">
                <h3
                  data-hero-title
                  class={`font-extrabold leading-tight text-2xl md:text-3xl xl:text-4xl ${textLight ? 'text-white' : 'text-gray-900'}`}
                >
                  {primary.title}
                </h3>
                {primary.subtitle && (
                  <p data-hero-subtitle class={`mt-2 text-sm md:text-base max-w-md ${textLight ? 'text-white/85' : 'text-gray-700'}`}>
                    {primary.subtitle}
                  </p>
                )}
                <span
                  data-hero-cta
                  class="hero-cta-btn inline-flex items-center gap-1.5 mt-4 bg-primary-fixed text-primary-dark font-bold rounded-lg hover:brightness-95 transition text-sm md:text-base px-5 py-2.5"
                >
                  {primary.cta_label}
                  <span class="material-symbols-outlined" style="font-size:1.1rem">arrow_forward</span>
                </span>
              </div>
            </div>
          </a>

          {campaigns.length > 1 && (
            <>
              <button
                type="button"
                id="hero-grid-prev-btn"
                aria-label="Previous campaign"
                aria-controls="hero-grid"
                class="hero-nav-btn absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-white"
              >
                <span class="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                id="hero-grid-next-btn"
                aria-label="Next campaign"
                aria-controls="hero-grid"
                class="hero-nav-btn absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-white"
              >
                <span class="material-symbols-outlined">chevron_right</span>
              </button>
              <div class="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2" role="tablist" aria-label="Campaign rotation">
                {campaigns.map((campaign, i) => (
                  <button
                    type="button"
                    class={`hero-grid-indicator-btn h-2 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-white ${i === 0 ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/75'}`}
                    data-window-start={i}
                    role="tab"
                    aria-selected={i === 0 ? 'true' : 'false'}
                    aria-label={`Bring ${campaign.title} to the front`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ZONES 2+3 — stacked right column (~35% combined: app promo ~20%, personalization ~15%) */}
        <div class="flex-[35] flex flex-col gap-3">
          {/* ZONE 2 — APP DOWNLOAD PROMO (static, real functional CTA) */}
          <div class="flex-[57] bg-gradient-to-br from-primary-dark to-primary rounded-xl p-4 flex items-center justify-between text-white overflow-hidden relative">
            <div class="min-w-0">
              <p class="font-bold text-base leading-tight">Get the NaijaDeals App</p>
              <p class="text-xs text-white/80 mt-1 leading-snug">Track orders, chat with sellers &amp; get app-only deals.</p>
              <button
                type="button"
                data-open-waitlist-modal
                data-preselect-service="allServices"
                class="inline-flex items-center gap-1 mt-2.5 bg-primary-fixed text-primary-dark text-xs font-bold px-3 py-1.5 rounded-lg hover:brightness-95 transition"
              >
                Join the waitlist
                <span class="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
            <span class="material-symbols-outlined text-6xl text-white/25 shrink-0 -mr-1" aria-hidden="true">qr_code_2</span>
          </div>

          {/* ZONE 3 — PERSONALIZATION CARD (real account data, or discovery fallback) */}
          {personalization && user ? (
            <a
              href="/account"
              class="flex-[43] bg-white border border-gray-200 rounded-xl p-4 flex flex-col hover:shadow-md hover:border-primary transition-all"
            >
              <p class="text-sm font-bold text-gray-900 truncate">Hi, {user.name?.split(' ')[0] || 'there'} 👋</p>
              <div class="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-600 flex-1">
                <div>
                  <span class="font-bold text-gray-900 text-sm block">{personalization.ordersCount}</span>
                  My Orders
                </div>
                <div>
                  <span class="font-bold text-gray-900 text-sm block">{personalization.wishlistCount}</span>
                  Wishlist
                </div>
                <div class="col-span-2">
                  <span class="font-bold text-primary text-sm block">{formatNaira(personalization.walletBalanceKobo)}</span>
                  NaijaWallet
                </div>
              </div>
              <span class="mt-2 text-xs font-semibold text-primary flex items-center gap-0.5">
                Continue shopping <span class="material-symbols-outlined text-sm">arrow_forward</span>
              </span>
            </a>
          ) : (
            <a
              href="/register"
              class="flex-[43] bg-white border border-gray-200 rounded-xl p-4 flex flex-col justify-center hover:shadow-md hover:border-primary transition-all"
            >
              <p class="text-sm font-bold text-gray-900">Join NaijaDeals</p>
              <p class="text-xs text-gray-500 mt-1 leading-snug">Track orders, save wishlists &amp; get personalized deals.</p>
              <span class="mt-2 text-xs font-semibold text-primary flex items-center gap-0.5">
                Create free account <span class="material-symbols-outlined text-sm">arrow_forward</span>
              </span>
            </a>
          )}
        </div>
      </div>

      {/* ============ MOBILE/TABLET (<lg): single-campaign swipeable carousel (unchanged pattern) ============ */}
      <div id="hero-mobile-carousel" class="lg:hidden relative overflow-hidden" data-autoplay-ms="6000">
        <div class="relative w-full aspect-[4/5] sm:aspect-[16/9] max-h-[560px]">
          {campaigns.map((campaign, i) => {
            const isFirst = i === 0
            const slideTextLight = campaign.theme === 'dark'
            return (
              <article
                class={`hero-mobile-slide absolute inset-0 transition-opacity duration-700 ease-in-out ${isFirst ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}
                data-slide-index={i}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${campaigns.length}: ${campaign.title}`}
                aria-hidden={isFirst ? 'false' : 'true'}
              >
                <a href={campaign.cta_href} class="absolute inset-0 block" aria-hidden="true" tabindex={-1}>
                  <picture>
                    <source media="(max-width: 767px)" srcset={campaign.image_mobile_url} />
                    <img
                      src={campaign.image_desktop_url}
                      alt=""
                      class="hero-slide-img w-full h-full object-cover bg-gradient-to-br from-primary-dark to-primary"
                      loading={isFirst ? 'eager' : 'lazy'}
                      fetchpriority={isFirst ? 'high' : 'low'}
                      decoding="async"
                      onerror="this.onerror=null;this.removeAttribute('src');this.classList.add('hero-img-failed')"
                    />
                  </picture>
                </a>
                <div
                  class={`absolute inset-0 flex items-end sm:items-center pointer-events-none ${slideTextLight ? 'bg-gradient-to-t sm:bg-gradient-to-r from-black/70 sm:from-black/55 via-black/20 sm:via-black/10 to-transparent' : 'bg-gradient-to-t sm:bg-gradient-to-r from-white/75 sm:from-white/65 via-white/25 sm:via-white/10 to-transparent'}`}
                >
                  <div class="max-w-[80rem] w-full mx-auto px-5 sm:px-8 pb-6 sm:pb-0">
                    <div class="max-w-sm pointer-events-auto">
                      <h2 class={`text-2xl sm:text-3xl font-extrabold leading-tight ${slideTextLight ? 'text-white' : 'text-gray-900'}`}>
                        {campaign.title}
                      </h2>
                      {campaign.subtitle && (
                        <p class={`mt-2 text-sm sm:text-base ${slideTextLight ? 'text-white/85' : 'text-gray-700'}`}>
                          {campaign.subtitle}
                        </p>
                      )}
                      <a
                        href={campaign.cta_href}
                        class="hero-cta-btn inline-flex items-center gap-1.5 mt-4 sm:mt-5 bg-primary-fixed text-primary-dark font-bold text-sm sm:text-base px-5 py-2.5 rounded-lg hover:brightness-95 transition"
                      >
                        {campaign.cta_label}
                        <span class="material-symbols-outlined text-lg">arrow_forward</span>
                      </a>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}

          {campaigns.length > 1 && (
            <>
              <button
                type="button"
                id="hero-mobile-prev-btn"
                aria-label="Previous slide"
                aria-controls="hero-mobile-carousel"
                class="hero-nav-btn absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-white"
              >
                <span class="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                id="hero-mobile-next-btn"
                aria-label="Next slide"
                aria-controls="hero-mobile-carousel"
                class="hero-nav-btn absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-white"
              >
                <span class="material-symbols-outlined">chevron_right</span>
              </button>
              <div class="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2" role="tablist" aria-label="Slide navigation">
                {campaigns.map((campaign, i) => (
                  <button
                    type="button"
                    class={`hero-mobile-indicator-btn h-2 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-white ${i === 0 ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/75'}`}
                    data-slide-index={i}
                    role="tab"
                    aria-selected={i === 0 ? 'true' : 'false'}
                    aria-label={`Go to slide ${i + 1}: ${campaign.title}`}
                  />
                ))}
              </div>
            </>
          )}

        </div>
        {/* Mobile companion strip: app promo + personalization, stacked below the slide, compact — keeps zones 2/3 present on mobile too, just stacked+compact rather than absent */}
        <div class="grid grid-cols-2 gap-2 px-3 py-3 bg-white border-t border-gray-100">
          <button type="button" data-open-waitlist-modal data-preselect-service="allServices" class="bg-gradient-to-br from-primary-dark to-primary rounded-lg p-2.5 text-white flex items-center gap-2 text-left">
            <span class="material-symbols-outlined text-xl shrink-0">qr_code_2</span>
            <span class="text-[11px] font-semibold leading-tight">Get the App — Join waitlist</span>
          </button>
          {personalization && user ? (
            <a href="/account" class="bg-white border border-gray-200 rounded-lg p-2.5 flex items-center gap-2">
              <span class="material-symbols-outlined text-xl shrink-0 text-primary">account_circle</span>
              <span class="text-[11px] font-semibold leading-tight text-gray-800">
                {formatNaira(personalization.walletBalanceKobo)} wallet · {personalization.wishlistCount} saved
              </span>
            </a>
          ) : (
            <a href="/register" class="bg-white border border-gray-200 rounded-lg p-2.5 flex items-center gap-2">
              <span class="material-symbols-outlined text-xl shrink-0 text-primary">person_add</span>
              <span class="text-[11px] font-semibold leading-tight text-gray-800">Join NaijaDeals free</span>
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
