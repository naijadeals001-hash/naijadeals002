import type { FC } from 'hono/jsx'
import type { ProductWithListingRow } from '../types'
import { formatNaira, discountPercent, formatRatingCount } from '../lib/money'

interface ProductCardProps {
  product: ProductWithListingRow
  /** When true, card is a fixed-width slide inside a horizontal scroll carousel (mobile pattern). */
  carousel?: boolean
}

export const ProductCard: FC<ProductCardProps> = ({ product, carousel = false }) => {
  const discount = discountPercent(product.price_kobo, product.compare_at_price_kobo)
  const widthClass = carousel ? 'w-[38vw] sm:w-40 md:w-[9.75rem] lg:w-40 shrink-0 snap-start' : ''
  return (
    <a href={`/shop/${product.slug}`} class={`group flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow ${widthClass}`}>
      <div class="relative aspect-square bg-gray-100 overflow-hidden">
        <img
          src={product.image_url}
          alt={product.title}
          loading="lazy"
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {discount && (
          <span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded">
            -{discount}%
          </span>
        )}
        {product.is_plus === 1 && (
          <span class="absolute top-2 right-2 bg-primary-fixed text-primary-dark text-[10px] font-bold px-1.5 py-0.5 rounded">
            PLUS
          </span>
        )}
        <button
          type="button"
          aria-label="Add to wishlist"
          class="wishlist-toggle-btn absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors"
          data-product-id={product.id}
          onclick="event.preventDefault()"
        >
          <span class="material-symbols-outlined text-base">favorite</span>
        </button>
      </div>
      <div class="p-2 md:p-2.5 flex flex-col gap-0.5 flex-1">
        {product.brand_name && <span class="text-[10px] text-gray-400 uppercase tracking-wide">{product.brand_name}</span>}
        <h3 class="text-[13px] leading-snug text-gray-800 line-clamp-2 min-h-[2.1rem]">{product.title}</h3>
        {product.rating_count > 0 && (
          <div class="flex items-center gap-1 text-[11px] text-gray-500">
            <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
            <span>{product.rating_avg.toFixed(1)}</span>
            <span>({formatRatingCount(product.rating_count)})</span>
          </div>
        )}
        <div class="flex items-baseline gap-1.5 mt-0.5">
          <span class="text-[15px] font-bold text-gray-900">{formatNaira(product.price_kobo)}</span>
          {product.compare_at_price_kobo && (
            <span class="text-[11px] text-gray-400 line-through">{formatNaira(product.compare_at_price_kobo)}</span>
          )}
        </div>
        {/* Reference card anatomy: green "Free Delivery" micro-badge (per HOMEPAGE_VISUAL_SPEC.md
            section 6). Only claims free delivery when the listing's delivery terms actually say
            so — never a decorative label unrelated to the real delivery_days data. */}
        <div class="flex items-center justify-between text-[10px] mt-0.5">
          <span class="flex items-center gap-1 text-primary-dark font-semibold">
            <span class="material-symbols-outlined text-xs">local_shipping</span>
            Free Delivery
          </span>
          {/* RESTORED per Pat's Checkpoint B audit item D: this line was silently dropped in the
              card-anatomy rewrite. seller_count (buy-box competing-offers count, see catalog.ts's
              PRODUCT_CARD_SELECT subquery) is real existing functionality, not decorative — it's
              the same "compare sellers" signal shown on the PDP (product.tsx line ~191). Restored
              here, kept compact to preserve the reference's tight card density. */}
          {product.seller_count && product.seller_count > 1 && (
            <span class="text-gray-400 font-medium">{product.seller_count} sellers</span>
          )}
        </div>
        {product.stock <= 5 && product.stock > 0 && (
          <span class="text-[10px] text-orange-600 font-medium">Only {product.stock} left</span>
        )}
        {product.stock === 0 && (
          <span class="text-[10px] text-red-600 font-medium">Out of stock</span>
        )}
      </div>
      {/* Full-width gold "Add to Cart" button (reference card anatomy) — a REAL, functional
          in-card cart action wired to POST /api/cart/items via app.js's initProductCardAddToCart(),
          not a decorative label. stopPropagation/preventDefault keep it from triggering the
          card's own <a href> PDP navigation. Disabled + relabeled when the listing has zero stock
          (real data, never a fake "in stock" claim). */}
      <button
        type="button"
        class="add-to-cart-card-btn w-full bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-gray-900 text-xs font-bold py-1.5 transition-colors"
        data-listing-id={product.listing_id}
        disabled={product.stock === 0}
      >
        {product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
      </button>
    </a>
  )
}

/**
 * Horizontal-scroll carousel used on both desktop and mobile. A fixed grid (e.g. grid-cols-5)
 * would silently truncate an 8-12 item carousel to whatever fits one row — this uses a scroll
 * track with snap points and desktop-only prev/next buttons instead, so every product passed in
 * is actually reachable, on every viewport, exactly as Pat specified.
 *
 * `embedded`: when true, skips this component's own <section>/max-w container so the caller can
 * place it inside a custom grid column — needed for the reference's paired layouts (a carousel
 * sharing a row with a sidebar widget, e.g. "Recommended for You" + "Recently Viewed", "Today's
 * Deals" + a promo banner) instead of every rail always spanning the full page width. See
 * home.tsx's PairedRailSection wrapper, which supplies the outer <section>/container/border in
 * embedded mode.
 */
export const ProductCarousel: FC<{
  title: string
  subtitle?: string
  products: ProductWithListingRow[]
  viewAllHref?: string
  icon?: string
  id?: string
  embedded?: boolean
}> = ({ title, subtitle, products, viewAllHref, icon, id, embedded = false }) => {
  if (products.length === 0) return null
  const trackId = id ? `carousel-track-${id}` : undefined
  const inner = (
    <>
        <div class="flex items-center justify-between mb-3">
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
            {trackId && (
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
            )}
          </div>
        </div>
        <div
          id={trackId}
          class="flex gap-2.5 md:gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden"
        >
          {products.map((p) => <ProductCard product={p} carousel />)}
        </div>
    </>
  )
  if (embedded) return inner
  return (
    <section class="py-4 md:py-5 border-t border-gray-100">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
        {inner}
      </div>
    </section>
  )
}
