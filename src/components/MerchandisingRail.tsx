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
  /** Real per-vertical accent (ecosystem_verticals.accent_color, migration 0010) — e.g.
   * 'green', 'amber', 'blue', 'purple', 'slate', 'orange', 'red', 'indigo'. Drives the
   * reference's tinted-pill treatment (Section 5 of HOMEPAGE_VISUAL_SPEC.md: "9 rounded
   * card buttons, each with a distinct tinted background color — one hue per vertical").
   * NaijaShop (synthesized, not a DB row) is given 'green' explicitly in home.tsx. */
  accent_color?: string
}

/** Tailwind requires statically-visible class strings for its JIT scanner — an
 * interpolated `bg-${color}-100` would be purged. This lookup keeps every class
 * literal so the CDN scanner (Layout.tsx's cdn.tailwindcss.com) always finds it. */
const ACCENT_CLASSES: Record<string, { bg: string; text: string; iconBg: string }> = {
  green: { bg: 'bg-green-50', text: 'text-green-700', iconBg: 'bg-green-100' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', iconBg: 'bg-amber-100' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', iconBg: 'bg-blue-100' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', iconBg: 'bg-purple-100' },
  slate: { bg: 'bg-slate-50', text: 'text-slate-700', iconBg: 'bg-slate-100' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', iconBg: 'bg-orange-100' },
  red: { bg: 'bg-red-50', text: 'text-red-700', iconBg: 'bg-red-100' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', iconBg: 'bg-indigo-100' }
}
const DEFAULT_ACCENT = ACCENT_CLASSES.green

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
    class="group flex flex-col w-[36vw] sm:w-36 md:w-[9.75rem] lg:w-40 shrink-0 snap-start rounded-lg overflow-hidden border border-gray-200 bg-white hover:shadow-md transition-shadow"
  >
    <div class="relative aspect-square bg-gray-100 overflow-hidden">
      <img
        src={category.image_url ?? undefined}
        alt={category.name}
        loading="lazy"
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
    </div>
    <div class="px-2 py-1.5 text-center">
      <h3 class="text-[13px] font-semibold text-gray-800 line-clamp-1">{category.name}</h3>
    </div>
  </a>
)

/**
 * Compact Ecosystem "pill" card (Checkpoint B, reference re-measurement:
 * reference cards are ~115x80px tinted pills — icon + 2-line stacked text,
 * NOT the large 16:9 photo-card block we had before, and NOT bare icon pills
 * either since Pat also requires real photography kept). This card threads
 * both requirements: a small real-photo roundel (keeps the "photography is
 * our enhancement" rule) inside a tinted pill sized/proportioned to the
 * reference (fixed ~104px width, ~84px height, rounded-xl), using the REAL
 * per-vertical accent_color from ecosystem_verticals (migration 0010) for
 * the tint — never an invented color.
 */
const EcosystemCard: FC<{ card: EcosystemSpotlightCard }> = ({ card }) => {
  const accent = (card.accent_color && ACCENT_CLASSES[card.accent_color]) || DEFAULT_ACCENT
  return (
    <a
      href={card.route}
      class={`group flex flex-col items-center justify-center gap-1 w-[104px] h-[84px] shrink-0 snap-start rounded-xl ${accent.bg} hover:brightness-95 transition-all px-1.5 py-2 text-center`}
    >
      <div class={`relative w-7 h-7 rounded-full overflow-hidden ${accent.iconBg} flex items-center justify-center shrink-0`}>
        <img
          src={card.hero_image_desktop}
          alt=""
          aria-hidden="true"
          loading="lazy"
          class="w-full h-full object-cover opacity-90"
        />
        <span class={`material-symbols-outlined absolute text-[13px] ${accent.text} drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]`}>{card.icon}</span>
      </div>
      <span class={`text-[11px] font-bold ${accent.text} leading-tight line-clamp-1 w-full`}>{card.name}</span>
      <span class="text-[9px] text-gray-500 leading-none line-clamp-1 w-full">{card.status === 'live' ? card.cta_label : 'Coming soon'}</span>
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
  // Ecosystem strip is a slim ~80px row in the reference (Row 3 of the section inventory) —
  // no full rail heading, just a small label + the pill track, much tighter than every other
  // rail's py-4/mb-3 chrome. This is the one variant that departs from the shared header size,
  // not the shared header STRUCTURE (still title-left, controls-right).
  const isEcosystem = variant === 'ecosystem'
  return (
    <section class={isEcosystem ? 'pt-2 pb-3' : 'py-4 md:py-5 border-t border-gray-100'}>
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
        <div class={`flex items-center justify-between ${isEcosystem ? 'mb-2' : 'mb-3'}`}>
          <div>
            <h2 class={isEcosystem ? 'text-sm font-bold text-gray-700 flex items-center gap-1.5' : 'text-lg md:text-xl font-bold text-gray-900 flex items-center gap-2'}>
              {icon && <span class={`material-symbols-outlined text-primary ${isEcosystem ? 'text-base' : ''}`}>{icon}</span>}
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
          class={`flex overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden ${isEcosystem ? 'gap-2' : 'gap-2.5 md:gap-3'}`}
        >
          {variant === 'product' && products.map((p) => <ProductCard product={p} carousel />)}
          {variant === 'category' && categories.map((c) => <CategoryCard category={c} />)}
          {variant === 'ecosystem' && ecosystemCards.map((card) => <EcosystemCard card={card} />)}
        </div>
      </div>
    </section>
  )
}
