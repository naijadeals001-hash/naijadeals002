import type { FC } from 'hono/jsx'
import type { HeroCampaignRow } from '../types'

/**
 * Homepage Hero Campaign Carousel — replaces the old hardcoded 3-panel banner grid
 * in home.tsx. Renders whatever active campaigns getActiveHeroCampaigns() returns;
 * this component has zero knowledge of any specific brand/vertical/campaign — every
 * slide's content comes entirely from the `campaigns` prop (DB → homepage-feed cache
 * → this component, per the locked architecture). If the backend ever returns zero
 * active campaigns, the section renders nothing rather than a placeholder.
 *
 * All slides are rendered server-side and present in the DOM (not lazily injected),
 * so there is no layout shift and the page is fully meaningful with JS disabled —
 * the first slide is simply what's visible without initHeroCarousel() running.
 * Client-side rotation/controls are implemented in public/static/app.js
 * (initHeroCarousel(), following the same IIFE pattern as initCarouselNav()).
 *
 * Responsive imagery: <picture> art-direction (not just resizing) — desktop gets a
 * wide 16:9 crop with the calm/text zone on the left, mobile gets a tighter 4:5
 * portrait crop centered on the subject, matching how the source photography was
 * composed. The 21:9-on-desktop / 4:5-on-mobile aspect-ratio wrapper is fixed via
 * CSS before any image loads, so there is never a layout jump.
 */
export const HeroCarousel: FC<{ campaigns: HeroCampaignRow[] }> = ({ campaigns }) => {
  if (!campaigns || campaigns.length === 0) return null

  return (
    <section
      id="hero-carousel"
      class="relative bg-gray-100 overflow-hidden"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured promotions"
      data-autoplay-ms="6000"
    >
      <div class="relative w-full aspect-[4/5] sm:aspect-[16/9] md:aspect-[21/9] max-h-[560px]">
        {campaigns.map((campaign, i) => {
          const isFirst = i === 0
          const textLight = campaign.theme === 'dark' // dark image -> light/white text
          return (
            <article
              class={`hero-slide absolute inset-0 transition-opacity duration-700 ease-in-out ${isFirst ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}
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
                <div class="max-w-[100rem] w-full mx-auto px-5 sm:px-8 md:px-12 lg:px-16 pb-6 sm:pb-0">
                  <div class="max-w-sm sm:max-w-md pointer-events-auto">
                    <h2 class={`text-2xl sm:text-3xl md:text-4xl font-extrabold leading-tight ${textLight ? 'text-white' : 'text-gray-900'}`}>
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
              id="hero-prev-btn"
              aria-label="Previous slide"
              aria-controls="hero-carousel"
              class="hero-nav-btn absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-white"
            >
              <span class="material-symbols-outlined">chevron_left</span>
            </button>
            <button
              type="button"
              id="hero-next-btn"
              aria-label="Next slide"
              aria-controls="hero-carousel"
              class="hero-nav-btn absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-white"
            >
              <span class="material-symbols-outlined">chevron_right</span>
            </button>

            <div class="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2" role="tablist" aria-label="Slide navigation">
              {campaigns.map((campaign, i) => (
                <button
                  type="button"
                  class={`hero-indicator-btn h-2 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-white ${i === 0 ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/75'}`}
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
    </section>
  )
}
