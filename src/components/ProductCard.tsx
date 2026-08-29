import type { FC } from 'hono/jsx'
import type { ProductRow } from '../types'
import { formatNaira, discountPercent, formatRatingCount } from '../lib/money'

export const ProductCard: FC<{ product: ProductRow }> = ({ product }) => {
  const discount = discountPercent(product.price_kobo, product.compare_at_price_kobo)
  return (
    <a href={`/shop/${product.slug}`} class="group flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
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
      </div>
      <div class="p-3 flex flex-col gap-1 flex-1">
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
      </div>
    </a>
  )
}
