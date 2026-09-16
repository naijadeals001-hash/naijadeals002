import type { FC } from 'hono/jsx'
import type { ProductWithListingRow, CategoryRow } from '../types'
import { ProductCard } from './ProductCard'

export interface EcosystemSpotlightCard {
  slug: string
  route: string
  name: string
  tagline: string
  icon: string
  cta_label: string
  hero_image_desktop: string
  status: 'live' | 'beta' | 'in_development' | 'coming_soon'
}

/**
 * MerchandisingRail — the single, shared horizontal-rail UI abstraction for
 * every "row of cards with a title, a See All link, and scroll arrows"
 * section on the homepage (Checkpoint B, Pat's "NO SHORTCUTS / EXACT
 * REFERENCE FIDELITY" directive, item 1).
 *
 * This is a literal generalization of ProductCarousel (src/components/
 * ProductCard.tsx) — same header layout (title left / See All + arrows
 * right), same track markup (`flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4
 * px-4 md:mx-0 md:px-0 snap-x scroll-smooth`), same `carousel-nav-btn` /
 * `data-target` / `data-dir` contract already wired in app.js (line ~902) —
 * NOT a new visual language. Pat's explicit instruction: "The content type
 * can change. The visual language should not."
 *
 * ProductCarousel itself is left untouched (it's proven, and other sections
 * still use it directly) — this component is the generalized sibling used
 * for non-product card types. Currently implements the two variants
 * Checkpoint B needs (`product`, `category`); `brand` / `vendor` /
 * `collection` variants are Checkpoint D/E scope and can be added the same
 * way without touching the shared chrome.
 */

interface CategoryWithCount extends CategoryRow {
  product_count?: number
}

type RailVariant = 'product' | 'category' | 'ecosystem'

interface MerchandisingRailProps {
  title: string
  subtitle?: string
  viewAllHref?: string
  icon?: string
  id: string
  variant: RailVariant
  products?: ProductWithListingRow[]
  categories?: CategoryWithCount[]
  ecosystemCards?: EcosystemSpotlightCard[]
}

/**
 * Category card — dominant real photography + name, per directive item 4
 * ("no icons, no placeholder, no empty cards"). Callers are responsible for
 * only passing rows whose image_url has already passed the real-asset filter
 * (see getFeaturedHomeCategories / getPopularCategories in catalog.ts) — this
 * component does not itself filter, it renders what it's given.
 */
const CategoryCard: FC<{ category: CategoryWithCount }> = ({ category }) => (
  <a
    href={`/shop?category=${category.slug}`}
    class="group flex flex-col w-[38vw] sm:w-40 md:w-44 lg:w-48 shrink-0 snap-start rounded-lg overflow-hidden border border-gray-200 bg-white hover:shadow-md transition-shadow"
  >
    <div class="relative aspect-square bg-gray-100 overflow-hidden">
      <img
        src={category.image_url ?? undefined}
        alt={category.name}
        loading="lazy"
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
    </div>
    <div class="px-2.5 py-2 text-center">
      <h3 class="text-sm font-semibold text-gray-800 line-clamp-1">{category.name}</h3>
    </div>
  </a>
)

/**
 * Compact Ecosystem card (Checkpoint B item 6: "NOT the current large
 * photo-card block, NOT plain icon pills"). Real photography retained
 * (directive: "The photography is our enhancement") but at rail-card scale —
 * same footprint as CategoryCard — with a vertical name + one-line
 * description + a compact CTA, instead of the old 16:9 hero-image block with
 * a full paragraph and status badge overlay.
 */
const EcosystemCard: FC<{ card: EcosystemSpotlightCard }> = ({ card }) => {
  const statusBadge =
    card.status === 'live'
      ? { label: 'Live', cls: 'bg-primary-fixed text-primary-dark' }
      : card.status === 'beta'
      ? { label: 'Beta', cls: 'bg-amber-100 text-amber-700' }
      : card.status === 'in_development'
      ? { label: 'Soon', cls: 'bg-blue-100 text-blue-600' }
      : { label: 'Coming', cls: 'bg-white/90 text-gray-700' }
  return (
    <a
      href={card.route}
      class="group flex flex-col w-[38vw] sm:w-40 md:w-44 lg:w-48 shrink-0 snap-start rounded-lg overflow-hidden border border-gray-200 bg-white hover:shadow-md transition-shadow"
    >
      <div class="relative aspect-square bg-gray-100 overflow-hidden">
        <img
          src={card.hero_image_desktop}
          alt={card.name}
          loading="lazy"
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <span class={`absolute top-1.5 left-1.5 text-[10px] font-bold rounded-full px-2 py-0.5 ${statusBadge.cls}`}>{statusBadge.label}</span>
      </div>
      <div class="px-2.5 py-2 flex flex-col gap-0.5 flex-1">
        <h3 class="text-sm font-semibold text-gray-800 flex items-center gap-1 line-clamp-1">
          <span class="material-symbols-outlined text-primary text-sm">{card.icon}</span>
          {card.name}
        </h3>
        <p class="text-[11px] text-gray-500 line-clamp-2 flex-1">{card.tagline}</p>
        <span class="text-[11px] font-semibold text-primary group-hover:underline mt-0.5">{card.cta_label} →</span>
      </div>
    </a>
  )
}

export const MerchandisingRail: FC<MerchandisingRailProps> = ({
  title,
  subtitle,
  viewAllHref,
  icon,
  id,
  variant,
  products = [],
  categories = [],
  ecosystemCards = []
}) => {
  const items = variant === 'product' ? products : variant === 'category' ? categories : ecosystemCards
  if (items.length === 0) return null
  const trackId = `carousel-track-${id}`
  return (
    <section class="py-6 md:py-8 border-t border-gray-100">
      <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg md:text-xl font-bold text-gray-900 flex items-center gap-2">
              {icon && <span class="material-symbols-outlined text-primary">{icon}</span>}
              {title}
            </h2>
            {subtitle && <p class="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {viewAllHref && (
              <a href={viewAllHref} class="text-sm font-semibold text-primary hover:underline flex items-center gap-0.5">
                See all<span class="material-symbols-outlined text-base">chevron_right</span>
              </a>
            )}
            <div class="hidden md:flex items-center gap-1.5 ml-2">
              <button
                type="button"
                aria-label="Scroll left"
                class="carousel-nav-btn w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-primary hover:text-primary transition-colors"
                data-target={trackId}
                data-dir="-1"
              >
                <span class="material-symbols-outlined text-lg">chevron_left</span>
              </button>
              <button
                type="button"
                aria-label="Scroll right"
                class="carousel-nav-btn w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-primary hover:text-primary transition-colors"
                data-target={trackId}
                data-dir="1"
              >
                <span class="material-symbols-outlined text-lg">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
        <div
          id={trackId}
          class="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden"
        >
          {variant === 'product' && products.map((p) => <ProductCard product={p} carousel />)}
          {variant === 'category' && categories.map((c) => <CategoryCard category={c} />)}
          {variant === 'ecosystem' && ecosystemCards.map((card) => <EcosystemCard card={card} />)}
        </div>
      </div>
    </section>
  )
}
