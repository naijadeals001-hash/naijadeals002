import type { FC } from 'hono/jsx'
import type { ProductWithListingRow } from '../types'
import { formatMoney, discountPercent, formatRatingCount } from '../lib/money'
import { FRESHNESS_LABEL, COLLECTION_BADGE_LABEL } from '../lib/fresh'

interface FreshProductCardProps {
  product: ProductWithListingRow
  carousel?: boolean
}

/**
 * NaijaFresh product card — same underlying anatomy/CSS classes/JS hooks as
 * the base ProductCard (components/ProductCard.tsx: same `.add-to-cart-card-btn`
 * / `.wishlist-toggle-btn` selectors, same app.js delegated handlers — no new
 * cart/wishlist wiring needed), EXTENDED with the Fresh-specific facts
 * §16 asks for: unit, freshness badge, variable-weight indicator, wholesale
 * indicator, collection badge, seller location. Ratings are shown only when
 * `rating_count > 0` — identical honest-zero rule as the base card.
 */
export const FreshProductCard: FC<FreshProductCardProps> = ({ product, carousel = false }) => {
  const discount = discountPercent(product.price_kobo, product.compare_at_price_kobo)
  const widthClass = carousel ? 'w-[42vw] sm:w-44 md:w-[11rem] lg:w-48 shrink-0 snap-start' : ''
  const freshness = product.freshness_status ? FRESHNESS_LABEL[product.freshness_status] : null
  const collectionSlugs = product.collection_slugs ? product.collection_slugs.split(',') : []
  const primaryCollectionBadge = collectionSlugs.map((s) => COLLECTION_BADGE_LABEL[s]).find((label) => !!label)
  const unitLabel = product.unit_of_measure
    ? `${product.unit_quantity && product.unit_quantity !== 1 ? product.unit_quantity : ''} ${product.unit_of_measure}`.trim()
    : null

  return (
    <a href={`/fresh/${product.slug}`} class={`group flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow ${widthClass}`}>
      <div class="relative aspect-square bg-gray-100 overflow-hidden">
        <img
          src={product.image_url}
          alt={product.title}
          loading="lazy"
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {/* Freshness badge — top-left, reference card anatomy. Only rendered when the product actually carries a freshness_status. */}
        {freshness && (
          <span class={`absolute top-2 left-2 ${freshness.color} text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1`}>
            <span class="material-symbols-outlined text-xs">{freshness.icon}</span>
            {freshness.label}
          </span>
        )}
        {discount && (
          <span class="absolute top-2 right-9 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded">-{discount}%</span>
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
      <div class="p-2.5 flex flex-col gap-1 flex-1">
        <div class="flex items-center gap-1.5 flex-wrap">
          {primaryCollectionBadge && (
            <span class="text-[9px] font-semibold text-primary-dark bg-primary-light px-1.5 py-0.5 rounded">{primaryCollectionBadge}</span>
          )}
          {product.has_wholesale_pricing ? (
            <span class="text-[9px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <span class="material-symbols-outlined text-[10px]">inventory_2</span>Bulk pricing
            </span>
          ) : null}
        </div>
        <h3 class="text-[13px] leading-snug text-gray-800 line-clamp-2 min-h-[2.1rem]">{product.title}</h3>
        {product.rating_count > 0 && (
          <div class="flex items-center gap-1 text-[11px] text-gray-500">
            <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
            <span>{product.rating_avg.toFixed(1)}</span>
            <span>({formatRatingCount(product.rating_count)})</span>
          </div>
        )}
        <div class="flex items-baseline gap-1.5 mt-0.5">
          <span class="text-[15px] font-bold text-gray-900">{formatMoney(product.price_kobo, product.currency)}</span>
          {unitLabel && <span class="text-[11px] text-gray-500">/ {unitLabel}</span>}
        </div>
        {product.is_variable_weight === 1 && (
          <p class="text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 leading-tight">
            Estimated price — final price may vary by weight
          </p>
        )}
        <div class="flex items-center gap-1 text-[11px] text-gray-500">
          <span class="material-symbols-outlined text-xs">storefront</span>
          <span class="truncate">{product.vendor_name}</span>
        </div>
        {(product.vendor_city || product.vendor_state) && (
          <div class="flex items-center gap-1 text-[10px] text-gray-400">
            <span class="material-symbols-outlined text-xs">location_on</span>
            <span class="truncate">{[product.vendor_city, product.vendor_state].filter(Boolean).join(', ')}</span>
          </div>
        )}
        {product.stock <= 5 && product.stock > 0 && (
          <span class="text-[10px] text-orange-600 font-medium">Only {product.stock} left</span>
        )}
        {product.stock === 0 && <span class="text-[10px] text-red-600 font-medium">Out of stock</span>}
      </div>
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

export const FreshProductCarousel: FC<{
  title: string
  subtitle?: string
  products: ProductWithListingRow[]
  viewAllHref?: string
  icon?: string
  id?: string
}> = ({ title, subtitle, products, viewAllHref, icon, id }) => {
  if (products.length === 0) return null
  const trackId = id ? `fresh-carousel-track-${id}` : undefined
  return (
    <section class="py-4 md:py-5 border-t border-gray-100">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
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
                <button type="button" aria-label="Scroll left" class="carousel-nav-btn w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-primary hover:text-primary transition-colors" data-target={trackId} data-dir="-1">
                  <span class="material-symbols-outlined text-lg">chevron_left</span>
                </button>
                <button type="button" aria-label="Scroll right" class="carousel-nav-btn w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-primary hover:text-primary transition-colors" data-target={trackId} data-dir="1">
                  <span class="material-symbols-outlined text-lg">chevron_right</span>
                </button>
              </div>
            )}
          </div>
        </div>
        <div id={trackId} class="flex gap-2.5 md:gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
          {products.map((p) => <FreshProductCard product={p} carousel />)}
        </div>
      </div>
    </section>
  )
}
