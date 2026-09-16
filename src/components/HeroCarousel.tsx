import type { FC } from 'hono/jsx'
import type { HeroCampaignRow } from '../types'

/**
 * Homepage Hero Campaign — DB-driven, admin-configurable-later, with TWO
 * presentations sharing the same `campaigns` data (from feed.hero_campaigns,
 * i.e. getActiveHeroCampaigns() via homepage-feed.ts's cache — unchanged):
 *
 *  - DESKTOP (lg: 1024px+): a 5-panel MOSAIC — 1 large primary campaign +
 *    up to 4 supporting campaign panels — reviving the original hero's
 *    visually-rich 5-image marketplace composition (per explicit product
 *    direction: "restore the 5-image hero, don't shrink it to 3"). All 5
 *    panels are always visible; what ROTATES is which campaign occupies
 *    which panel (position 0 = "primary" DOM slot, 1-4 = "support" slots),
 *    driven by public/static/app.js's initHeroGrid(). Rotating CONTENT
 *    into fixed slots (rather than cross-fading whole panels) avoids any
 *    layout shift and keeps all 5 panels visible at all times, per spec.
 *
 *  - MOBILE/TABLET (<lg): a single-campaign swipeable carousel — one
 *    primary campaign full-width, swipe/keyboard/dots to move through the
 *    rest — because 5 panels cannot usefully fit a 375px screen. This is
 *    the exact carousel UX already verified (autoplay, hover-pause,
 *    keyboard, swipe, reduced-motion, indicators) — untouched, just scoped
 *    to <lg via `lg:hidden` and given its own element ids/classes so it
 *    doesn't collide with the desktop grid's ids in the DOM at the same
 *    time (both are always rendered; CSS display toggles which is visible per breakpoint).
 *
 * Both presentations render 100% server-side from the `campaigns` prop —
 * zero hardcoded campaign content, matching every other section on this
 * page. If zero active campaigns are returned, the whole section renders
 * nothing (no placeholder).
 */
export const HeroCarousel: FC<{ campaigns: HeroCampaignRow[] }> = ({ campaigns }) => {
  if (!campaigns || campaigns.length === 0) return null

  const gridSize = Math.min(campaigns.length, 5)
  const gridSlots = campaigns.slice(0, gridSize)
  const supportCount = gridSize - 1

  // Compact payload for client-side rotation (initHeroGrid() in app.js) — only the
  // fields a slot actually needs to re-render its content when the rotation window
  // shifts. Still 100% of what's in `campaigns`; nothing invented, nothing dropped.
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
    <section
      id="hero-carousel"
      class="relative bg-gray-100"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured promotions"
    >
      {/* ============ DESKTOP: 5-panel mosaic (1 primary + up to 4 supporting) ============ */}
      <div
        id="hero-grid"
        class="hidden lg:flex gap-3 lg:h-[440px] xl:h-[480px]"
        data-autoplay-ms="6000"
        data-total={campaigns.length}
        data-campaigns={JSON.stringify(rotationPayload)}
      >
        <HeroPanel campaign={gridSlots[0]} slotIndex={0} role="primary" />

        {supportCount > 0 && (
          <div
            class="flex-1 grid gap-3"
            style={`grid-template-rows: repeat(${supportCount}, minmax(0, 1fr))`}
          >
            {gridSlots.slice(1).map((campaign, i) => (
              <HeroPanel campaign={campaign} slotIndex={i + 1} role="support" />
            ))}
          </div>
        )}

        {campaigns.length > 1 && (
          <>
            <button
              type="button"
              id="hero-grid-prev-btn"
              aria-label="Rotate campaigns backward"
              aria-controls="hero-grid"
              class="hero-nav-btn absolute left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-white"
            >
              <span class="material-symbols-outlined">chevron_left</span>
            </button>
            <button
              type="button"
              id="hero-grid-next-btn"
              aria-label="Rotate campaigns forward"
              aria-controls="hero-grid"
              class="hero-nav-btn absolute right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-white"
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

      {/* ============ MOBILE/TABLET (<lg): single-campaign swipeable carousel ============ */}
      <div id="hero-mobile-carousel" class="lg:hidden relative overflow-hidden" data-autoplay-ms="6000">
        <div class="relative w-full aspect-[4/5] sm:aspect-[16/9] max-h-[560px]">
          {campaigns.map((campaign, i) => {
            const isFirst = i === 0
            const textLight = campaign.theme === 'dark'
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
                  class={`absolute inset-0 flex items-end sm:items-center pointer-events-none ${textLight ? 'bg-gradient-to-t sm:bg-gradient-to-r from-black/70 sm:from-black/55 via-black/20 sm:via-black/10 to-transparent' : 'bg-gradient-to-t sm:bg-gradient-to-r from-white/75 sm:from-white/65 via-white/25 sm:via-white/10 to-transparent'}`}
                >
                  <div class="max-w-[80rem] w-full mx-auto px-5 sm:px-8 pb-6 sm:pb-0">
                    <div class="max-w-sm pointer-events-auto">
                      <h2 class={`text-2xl sm:text-3xl font-extrabold leading-tight ${textLight ? 'text-white' : 'text-gray-900'}`}>
                        {campaign.title}
                      </h2>
                      {campaign.subtitle && (
                        <p class={`mt-2 text-sm sm:text-base ${textLight ? 'text-white/85' : 'text-gray-700'}`}>
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
      </div>
    </section>
  )
}

/**
 * One mosaic panel — either the large "primary" slot (slot 0, full title +
 * subtitle + CTA pill, larger type) or a smaller "support" slot (slots 1-4,
 * compact title + small CTA pill). Fixed DOM position per slotIndex; its
 * CONTENT (image/title/subtitle/cta/theme) is what initHeroGrid() rotates —
 * see data-hero-slot below, which is how the client script finds each panel.
 */
const HeroPanel: FC<{ campaign: HeroCampaignRow; slotIndex: number; role: 'primary' | 'support' }> = ({
  campaign,
  slotIndex,
  role
}) => {
  const isPrimary = role === 'primary'
  const textLight = campaign.theme === 'dark'

  return (
    <a
      href={campaign.cta_href}
      class={`hero-panel group relative rounded-xl overflow-hidden block h-full bg-gray-200 ${isPrimary ? 'flex-[2]' : ''}`}
      data-hero-slot={slotIndex}
      data-role={role}
    >
      <picture>
        <source data-hero-mobile-src media="(max-width: 767px)" srcset={campaign.image_mobile_url} />
        <img
          data-hero-img
          src={campaign.image_desktop_url}
          alt=""
          class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          loading={isPrimary ? 'eager' : 'lazy'}
          fetchpriority={isPrimary ? 'high' : 'low'}
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
        <div class={isPrimary ? 'p-4 md:p-6' : 'p-3'}>
          <h3
            data-hero-title
            class={`font-extrabold leading-tight ${isPrimary ? 'text-xl md:text-2xl xl:text-3xl' : 'text-sm md:text-base line-clamp-2'} ${
              textLight ? 'text-white' : 'text-gray-900'
            }`}
          >
            {campaign.title}
          </h3>
          {isPrimary && campaign.subtitle && (
            <p data-hero-subtitle class={`mt-1.5 text-sm md:text-base max-w-md ${textLight ? 'text-white/85' : 'text-gray-700'}`}>
              {campaign.subtitle}
            </p>
          )}
          <span
            data-hero-cta
            class={`hero-cta-btn inline-flex items-center gap-1 mt-3 bg-primary-fixed text-primary-dark font-bold rounded-lg hover:brightness-95 transition ${
              isPrimary ? 'text-sm md:text-base px-4 py-2' : 'text-xs px-2.5 py-1'
            }`}
          >
            {campaign.cta_label}
            <span class="material-symbols-outlined" style={isPrimary ? 'font-size:1.1rem' : 'font-size:0.9rem'}>
              arrow_forward
            </span>
          </span>
        </div>
      </div>
    </a>
  )
}
