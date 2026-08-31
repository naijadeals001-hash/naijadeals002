export type Bindings = {
  DB: D1Database
  SELLER_UPLOADS: R2Bucket
  PAYOUT_ENCRYPTION_KEY: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    user: AuthUser | null
    /** Set by requireActiveSeller (src/lib/seller.ts) once ownership is resolved server-side. Never trust a client-supplied vendor id — this is the ONLY legitimate source. */
    sellerVendor?: VendorRow
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
  // --- Seller Portal foundation (migration 0009) ---
  /** NULL for the 20 pre-seeded catalog vendors. Set once a real user claims/creates this store. */
  user_id: number | null
  business_name: string | null
  business_type: 'individual' | 'company' | null
  business_email: string | null
  business_phone: string | null
  /** Admin-controlled verification state machine. is_verified above is kept in sync for backward compat with existing catalog queries. */
  verification_status: 'pending' | 'verified' | 'rejected' | 'suspended'
  verification_note: string | null
  /** Which of the 6 onboarding wizard steps to resume at. */
  onboarding_step: number
  onboarding_completed_at: string | null
  terms_accepted_at: string | null
  terms_version: string | null
  /** Seller-controlled "pause my store" — distinct from admin-controlled verification_status. */
  store_status: 'active' | 'paused' | 'suspended'
}

export interface NigerianBankRow {
  id: number
  name: string
  code: string
  sort_order: number
}

/**
 * A seller's bank account for receiving payouts. account_number_encrypted is
 * NEVER returned to normal seller-facing reads — always project account_number_last4
 * instead for masked display ("•••••• + last4"). See src/lib/payouts.ts.
 */
export interface SellerPayoutAccountRow {
  id: number
  vendor_id: number
  bank_name: string
  bank_code: string
  account_name: string
  account_number_encrypted: string
  account_number_last4: string
  is_default: number
  status: 'active' | 'removed'
  created_at: string
  updated_at: string
}

/** Masked/safe shape of a payout account for any seller-facing API response — never includes the encrypted field. */
export interface SellerPayoutAccountPublic {
  id: number
  vendor_id: number
  bank_name: string
  account_name: string
  account_number_masked: string // e.g. "••••••1234"
  is_default: boolean
  status: 'active' | 'removed'
  created_at: string
}

export interface SellerPayoutAccountAuditRow {
  id: number
  payout_account_id: number | null
  vendor_id: number
  action: 'created' | 'updated' | 'set_default' | 'removed'
  performed_by_user_id: number
  detail: string
  created_at: string
}

/** Cached available-earnings balance, keyed by vendor_id (the store), NOT user_id — see migration 0009 comments. */
export interface SellerFinanceAccountRow {
  vendor_id: number
  cached_available_kobo: number
  updated_at: string
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

/** One slide in the homepage Hero Campaign Carousel — see src/lib/hero-campaigns.ts. */
export interface HeroCampaignRow {
  id: number
  slug: string
  title: string
  subtitle: string | null
  image_desktop_url: string
  image_mobile_url: string
  cta_label: string
  cta_href: string
  vertical: string
  theme: 'dark' | 'light'
  display_order: number
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
