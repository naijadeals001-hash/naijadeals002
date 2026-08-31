export type Bindings = {
  DB: D1Database
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    user: AuthUser | null
  }
}

export interface AuthUser {
  id: number
  email: string | null
  phone: string | null
  name: string
  role: string
}

export interface CategoryRow {
  id: number
  slug: string
  name: string
  icon: string
  image_url: string | null
  parent_id: number | null
  sort_order: number
}

export interface BrandRow {
  id: number
  slug: string
  name: string
  logo_url: string | null
  is_nigerian: number
  description: string
}

export interface VendorRow {
  id: number
  slug: string
  name: string
  description: string | null
  logo_url: string | null
  banner_url: string | null
  city: string | null
  state: string
  is_verified: number
  rating_avg: number
  rating_count: number
  positive_feedback_percent: number
  response_time_hours: number
  joined_year: number
}

/** Canonical catalog entry — NOT tied to a specific seller. */
export interface ProductRow {
  id: number
  slug: string
  category_id: number
  brand_id: number | null
  title: string
  description: string
  long_description: string
  specs_json: string
  whats_included_json: string
  image_url: string
  gallery_json: string
  rating_avg: number
  rating_count: number
  sales_count: number
  is_flash_deal: number
  is_active: number
  return_policy: string
  category_name?: string
  category_slug?: string
  brand_name?: string
  brand_slug?: string
}

/** One seller's offer on a product — the "buy box". This is what cart/order/comparison reference. */
export interface ListingRow {
  id: number
  product_id: number
  vendor_id: number
  price_kobo: number
  compare_at_price_kobo: number | null
  stock: number
  condition: string
  delivery_days_min: number
  delivery_days_max: number
  warranty_months: number
  is_plus: number
  is_primary: number
  is_active: number
}

/** A product row joined with its primary (buy-box) listing — the shape used on cards/grids. */
export interface ProductWithListingRow extends ProductRow {
  listing_id: number
  vendor_id: number
  vendor_name: string
  vendor_slug: string
  price_kobo: number
  compare_at_price_kobo: number | null
  stock: number
  delivery_days_min: number
  delivery_days_max: number
  is_plus: number
  seller_count?: number
}

export interface VariantRow {
  id: number
  listing_id: number
  variant_type: string
  variant_value: string
  price_delta_kobo: number
  stock: number
  sort_order: number
}

export interface ReviewRow {
  id: number
  product_id: number
  user_id: number | null
  author_name: string
  avatar_url: string | null
  rating: number
  title: string
  comment: string
  has_photo: number
  photo_url: string | null
  helpful_count: number
  is_verified_purchase: number
  created_at: string
}

export interface QuestionRow {
  id: number
  product_id: number
  user_id: number | null
  author_name: string
  question: string
  answer: string | null
  answered_by: string | null
  helpful_count: number
  created_at: string
}

/** A cart item joined with its listing + product + vendor context — the shape rendered in cart/checkout. */
export interface CartItemRow {
  id: number
  cart_id: number
  listing_id: number
  variant_id: number | null
  quantity: number
  is_saved_for_later: number
  product_id: number
  title: string
  slug: string
  image_url: string
  price_kobo: number
  compare_at_price_kobo: number | null
  stock: number
  vendor_id: number
  vendor_name: string
  vendor_slug: string
  is_verified: number
  delivery_days_min: number
  delivery_days_max: number
  variant_value: string | null
}

export interface OrderRow {
  id: number
  order_number: string
  user_id: number
  status: string
  payment_status: string
  payment_provider: string | null
  payment_reference: string | null
  subtotal_kobo: number
  delivery_fee_kobo: number
  total_kobo: number
  currency: string
  shipping_name: string
  shipping_phone: string
  shipping_address: string
  shipping_city: string
  shipping_state: string
  delivery_method: string
  coupon_code: string | null
  discount_kobo: number
  created_at: string
}

export interface OrderItemRow {
  id: number
  order_id: number
  listing_id: number
  product_id: number
  vendor_id: number
  variant_snapshot: string | null
  title_snapshot: string
  image_snapshot: string
  unit_price_kobo: number
  quantity: number
  line_total_kobo: number
  item_status: string
}

export interface AddressRow {
  id: number
  user_id: number
  label: string
  recipient_name: string
  phone: string
  line1: string
  city: string
  state: string
  is_default: number
  delivery_instructions: string | null
}

export interface WishlistRow {
  id: number
  user_id: number
  product_id: number
  created_at: string
}
