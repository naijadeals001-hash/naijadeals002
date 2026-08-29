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
  const widthClass = carousel ? 'w-[42vw] sm:w-44 md:w-auto shrink-0' : ''
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
      <div class="p-3 flex flex-col gap-1 flex-1">
        {product.brand_name && <span class="text-[11px] text-gray-400 uppercase tracking-wide">{product.brand_name}</span>}
        <h3 class="text-sm text-gray-800 line-clamp-2 min-h-[2.5rem]">{product.title}</h3>
        {product.rating_count > 0 && (
          <div class="flex items-center gap-1 text-xs text-gray-500">
            <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
            <span>{product.rating_avg.toFixed(1)}</span>
            <span>({formatRatingCount(product.rating_count)})</span>
          </div>
        )}
        <div class="flex items-baseline gap-2 mt-1">
          <span class="text-base font-bold text-gray-900">{formatNaira(product.price_kobo)}</span>
          {product.compare_at_price_kobo && (
            <span class="text-xs text-gray-400 line-through">{formatNaira(product.compare_at_price_kobo)}</span>
          )}
        </div>
        <div class="flex items-center justify-between text-[11px] text-gray-500 mt-0.5">
          <span class="flex items-center gap-0.5">
            <span class="material-symbols-outlined text-xs">local_shipping</span>
            {product.delivery_days_min === product.delivery_days_max
              ? `${product.delivery_days_min}-day delivery`
              : `${product.delivery_days_min}-${product.delivery_days_max} day delivery`}
          </span>
          {product.seller_count && product.seller_count > 1 && (
            <span class="text-primary font-medium">{product.seller_count} sellers</span>
          )}
        </div>
        {product.stock <= 5 && product.stock > 0 && (
          <span class="text-[11px] text-orange-600 font-medium">Only {product.stock} left</span>
        )}
        {product.stock === 0 && (
          <span class="text-[11px] text-red-600 font-medium">Out of stock</span>
        )}
      </div>
    </a>
  )
}

/** Horizontal-scroll wrapper for mobile carousels — desktop shows the same items as a static grid. */
export const ProductCarousel: FC<{ title: string; subtitle?: string; products: ProductWithListingRow[]; viewAllHref?: string; icon?: string }> = ({
  title, subtitle, products, viewAllHref, icon
}) => {
  if (products.length === 0) return null
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
          {viewAllHref && (
            <a href={viewAllHref} class="text-sm font-semibold text-primary hover:underline shrink-0 flex items-center gap-0.5">
              See all<span class="material-symbols-outlined text-base">chevron_right</span>
            </a>
          )}
        </div>
        <div class="flex md:grid md:grid-cols-5 gap-3 md:gap-4 overflow-x-auto md:overflow-visible pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x">
          {products.map((p) => <ProductCard product={p} carousel />)}
        </div>
      </div>
    </section>
  )
}
