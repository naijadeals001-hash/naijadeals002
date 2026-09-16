import type { FC } from 'hono/jsx'

/**
 * PairedRailSection — the reference's recurring "wide carousel + narrow sidebar
 * widget" row pattern (Recommended for You + Recently Viewed; Today's Deals +
 * a promo banner; Explore Africa + Made in Africa banner). Our previous
 * implementation had ZERO sections using this pattern — every rail was a
 * single full-width carousel, which is the #1 architectural gap Pat's
 * side-by-side comparison identified ("the reference constantly alternates
 * layout, ours is carousel -> carousel -> carousel").
 *
 * This component owns the shared <section>/container/border chrome; callers
 * pass an EMBEDDED <ProductCarousel embedded> or <MerchandisingRail embedded>
 * as `main`, plus arbitrary sidebar markup as `sidebar`. Column split is
 * ~74/26 on desktop (roughly matches the reference's carousel-vs-sidebar
 * width ratio), collapsing to a simple stack on mobile — sidebar renders
 * BELOW the carousel on narrow screens, never squeezed into a broken column.
 */
export const PairedRailSection: FC<{
  id?: string
  sidebar: any
  sidebarClass?: string
  /** Overrides the sidebar column's width classes (default keeps the original ~280/300px column
   *  used by the Today's Deals and Explore Africa pairings). The Recommended-for-You pairing passes
   *  a narrower value here to land its main/sidebar split inside a ~75-82% / ~18-25% target range. */
  sidebarWidthClass?: string
  children?: any
}> = ({ id, sidebar, sidebarClass = '', sidebarWidthClass = 'lg:w-[280px] xl:w-[300px]', children }) => {
  return (
    <section id={id} class="py-4 md:py-5 border-t border-gray-100">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
        <div class="flex flex-col lg:flex-row gap-5 lg:gap-6">
          <div class="flex-1 min-w-0">{children}</div>
          <div class={`${sidebarWidthClass} shrink-0 ${sidebarClass}`}>{sidebar}</div>
        </div>
      </div>
    </section>
  )
}

/**
 * Standard promo-sidebar card — a single real-photo banner with an overlay
 * headline + CTA, sized to sit naturally beside a carousel. Used for the
 * "Today's Deals" pairing (reuses banner-1.jpg, a real pre-existing/unused
 * asset — per Pat's "don't generate new assets this iteration" instruction)
 * and the "Explore Africa" pairing (banner-2.jpg / banner-5.jpg).
 */
export const PromoSidebarCard: FC<{
  image: string
  eyebrow?: string
  title: string
  subtitle?: string
  ctaLabel: string
  href: string
  theme?: 'light' | 'dark'
}> = ({ image, eyebrow, title, subtitle, ctaLabel, href, theme = 'dark' }) => (
  <a href={href} class="group relative block h-full min-h-[260px] lg:min-h-full rounded-xl overflow-hidden border border-gray-200">
    <img src={image} alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />
    <div class={`absolute inset-0 flex flex-col justify-end p-4 ${theme === 'dark' ? 'bg-gradient-to-t from-black/80 via-black/25 to-transparent' : 'bg-gradient-to-t from-white/85 via-white/30 to-transparent'}`}>
      {eyebrow && <span class={`text-[11px] font-bold uppercase tracking-wide ${theme === 'dark' ? 'text-primary-fixed' : 'text-primary-dark'}`}>{eyebrow}</span>}
      <h3 class={`text-lg font-extrabold leading-tight mt-1 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
      {subtitle && <p class={`text-xs mt-1 leading-snug ${theme === 'dark' ? 'text-white/85' : 'text-gray-700'}`}>{subtitle}</p>}
      <span class={`inline-flex items-center gap-1 mt-3 text-sm font-bold ${theme === 'dark' ? 'text-primary-fixed' : 'text-primary-dark'}`}>
        {ctaLabel}
        <span class="material-symbols-outlined text-base">arrow_forward</span>
      </span>
    </div>
  </a>
)
