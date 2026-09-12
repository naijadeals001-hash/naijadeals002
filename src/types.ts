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
    /** Set by attachLocale (src/lib/auth.ts) on every request — resolved language/dir/source, never a raw IP. See src/i18n/. */
    locale: import('./i18n/types').LocaleContext
    /**
     * Set by requireOrganizationMember (src/lib/rbac.ts) once membership is
     * resolved server-side from the AUTHENTICATED session user's id — NEVER
     * from a client-supplied organization_id alone. See src/lib/organizations.ts's
     * resolveMembership for why this makes cross-organization access
     * structurally impossible. Import type kept inline to avoid a circular
     * import between types.ts and lib/organizations.ts.
     */
    orgMembership?: import('./lib/organizations').MembershipResolution
    /**
     * Set by requireActiveProvider (src/lib/providers.ts) once the
     * gig_provider profile is resolved server-side from the AUTHENTICATED
     * session user's id — NEVER from a client-supplied provider_profile_id.
     * Mirrors sellerVendor/orgMembership's resolution discipline exactly for
     * the Service Engine (migration 0039).
     */
    providerProfile?: ProviderProfileRow
  }
}

export interface AuthUser {
  id: number
  email: string | null
  phone: string | null
  name: string
  role: string
  /** Nullable — NULL means "no saved preference yet", detector falls through to cookie/browser/country. Migration 0012. */
  preferred_language?: string | null
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
  // --- Marketplace Engine 2.0 (migration 0038): vendor <-> organization bridge ---
  /** NULL for user-owned/individual stores. Set when an Identity Engine organization owns this store. */
  organization_id: number | null
  /** Soft classification, not a CHECK constraint: individual | business | organization | manufacturer | distributor | wholesaler | farmer | retailer | brand */
  store_type: string
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
  /** Marketplace Engine 2.0 (migration 0038): draft | pending_review | active | paused | rejected | archived */
  moderation_status?: string
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
  // --- Marketplace Engine 2.0 (migration 0038) ---
  moderation_status?: string
  unit_of_measure?: string
  unit_quantity?: number
  is_variable_weight?: number
  variable_weight_tolerance_pct?: number
  reserved_quantity?: number
  low_stock_threshold?: number
  allow_backorder?: number
  sku?: string | null
  warehouse_location?: string | null
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

/** Status lifecycle for an ecosystem vertical preview — see src/lib/ecosystem-verticals.ts. */
export type EcosystemVerticalStatus = 'coming_soon' | 'in_development' | 'beta' | 'live'

/** One planned NaijaDeals vertical (NaijaFresh, NaijaEats, etc.) — see migration 0010. */
export interface EcosystemVerticalRow {
  id: number
  slug: string
  route: string
  name: string
  tagline: string
  description: string
  icon: string
  accent_color: string
  hero_image_desktop: string
  hero_image_mobile: string
  status: EcosystemVerticalStatus
  cta_label: string
  seo_title: string
  seo_description: string
  display_order: number
}

/** One planned feature card on an ecosystem vertical preview page. */
export interface EcosystemVerticalFeatureRow {
  id: number
  vertical_id: number
  icon: string
  title: string
  description: string
  display_order: number
}

/** Status lifecycle for a v2 ecosystem waitlist signup — see migration 0011. */
export type EcosystemWaitlistStatus = 'pending' | 'notified' | 'contacted' | 'unsubscribed'

/**
 * One person on the v2 ecosystem waitlist (migration 0011 —
 * ecosystem_waitlist_signups). Deliberately NOT the same shape as
 * EcosystemVerticalRow/0010's per-vertical ecosystem_waitlist — this is the
 * richer, real-fields-collected-via-modal system. See migration 0011's
 * header comment for why this is a separate table.
 */
export interface EcosystemWaitlistSignupRow {
  id: number
  full_name: string
  email: string
  phone: string
  city: string
  state: string
  naija_eats: number
  naija_gigs: number
  naija_stay: number
  all_services: number
  status: EcosystemWaitlistStatus
  created_at: string
  updated_at: string
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
  // --- Marketplace Engine 2.0 (migration 0038): fuller order lifecycle ---
  cancelled_at?: string | null
  cancellation_reason?: string | null
  cancelled_by_user_id?: number | null
  fulfilled_at?: string | null
  delivered_at?: string | null
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
  // --- Marketplace Engine 2.0 (migration 0038) ---
  fulfilled_quantity?: number | null
  final_price_kobo?: number | null
  unit_of_measure?: string
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

// ============================================================
// Affiliate program (migrations 0017/0018 — reconstructed from
// production's recovered schema, see docs/NAIJADEALS-PRODUCTION-SCHEMA-MAP.md)
// ============================================================

export type AffiliateStatus = 'active' | 'pending' | 'suspended' | 'rejected'

/** One user's affiliate enrollment. user_id is UNIQUE — one affiliate profile per account. */
export interface AffiliateProfileRow {
  id: number
  user_id: number
  status: AffiliateStatus
  display_name: string | null
  /** Default commission rate in basis points (500 = 5%). Schema default observed on production; see calculateCommissionBps() — the exact real-world formula/overrides are UNKNOWN — SOURCE CODE REQUIRED, this is the only recoverable fallback value. */
  default_commission_bps: number
  payout_threshold_kobo: number
  payout_method: string | null
  payout_destination_json: string | null
  suspended_reason: string | null
  reviewed_by_user_id: number | null
  reviewed_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

export interface AffiliateReferralCodeRow {
  id: number
  affiliate_id: number
  code: string
  is_primary: number
  is_active: number
  created_at: string
}

export interface AffiliateClickRow {
  id: number
  referral_code_id: number
  affiliate_id: number
  campaign_id: number | null
  click_token: string
  landing_path: string
  referrer: string | null
  ip_hash: string | null
  user_agent: string | null
  created_at: string
}

export type AffiliateAttributionStatus = 'pending' | 'converted' | 'expired'

export interface AffiliateAttributionRow {
  id: number
  click_id: number | null
  affiliate_id: number
  referral_code_id: number
  campaign_id: number | null
  attribution_token: string
  customer_user_id: number | null
  status: AffiliateAttributionStatus
  first_touch_at: string
  last_touch_at: string
  expires_at: string
  created_at: string
}

export type AffiliateCommissionStatus = 'pending' | 'approved' | 'reversed' | 'paid'

export interface AffiliateCommissionRow {
  id: number
  affiliate_id: number
  attribution_id: number
  campaign_id: number | null
  order_id: number
  order_item_id: number
  listing_id: number
  product_id: number
  vendor_id: number
  customer_user_id: number
  commission_basis: string
  commission_rate_bps: number | null
  gross_kobo: number
  commission_kobo: number
  status: AffiliateCommissionStatus
  approved_by_user_id: number | null
  approved_at: string | null
  reversed_at: string | null
  reversed_reason: string | null
  payout_id: number | null
  created_at: string
  updated_at: string
}

export interface AffiliateAccountRow {
  affiliate_id: number
  cached_available_kobo: number
  updated_at: string
}

export interface AffiliateLedgerEntryRow {
  id: number
  affiliate_id: number
  entry_type: 'credit' | 'debit'
  amount_kobo: number
  balance_after_kobo: number
  reference_type: string
  reference_id: string | null
  commission_id: number | null
  order_id: number | null
  description: string
  created_at: string
}

export type AffiliatePayoutStatus = 'requested' | 'approved' | 'rejected' | 'paid'

export interface AffiliatePayoutRow {
  id: number
  affiliate_id: number
  amount_kobo: number
  status: AffiliatePayoutStatus
  payout_method: string | null
  external_reference: string | null
  requested_at: string
  decided_by_user_id: number | null
  decided_at: string | null
  paid_at: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Identity & Account Engine 2.0 (migration 0037) — universal
// organization/RBAC/preferences foundation. See that migration's header
// comment for the full compatibility rationale. Column shapes below match
// migration 0037's CREATE TABLE statements exactly.
// ============================================================

export type AccountStatus = 'active' | 'pending_verification' | 'suspended' | 'disabled' | 'deleted'

/** account_preferences — one row per user, created lazily on first write (src/lib/account.ts). */
export interface AccountPreferencesRow {
  user_id: number
  language: string
  currency_code: string
  timezone: string
  notification_prefs_json: string
  marketing_opt_in: number
  privacy_prefs_json: string
  accessibility_prefs_json: string
  updated_at: string
}

export type OrganizationStatus = 'active' | 'suspended' | 'disabled'
export type OrganizationVerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected' | 'suspended'

/** organizations — the core new business/organization identity entity. organization_type is intentionally free-form TEXT, not a CHECK enum (Section 3). */
export interface OrganizationRow {
  id: number
  name: string
  display_name: string | null
  organization_type: string
  logo_url: string | null
  description: string
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  country_iso: string
  status: OrganizationStatus
  verification_status: OrganizationVerificationStatus
  verification_note: string | null
  settings_json: string
  created_by_user_id: number
  created_at: string
  updated_at: string
}

/** organization_permissions — global permission catalog shared by every organization/vertical. */
export interface OrganizationPermissionRow {
  id: number
  key: string
  category: string
  name: string
  description: string
}

/** organization_roles — organization_id IS NULL = seeded system role (owner/admin/manager/staff); organization_id set = a custom role scoped to that one organization. */
export interface OrganizationRoleRow {
  id: number
  organization_id: number | null
  key: string
  name: string
  description: string
  is_system: number
  created_at: string
}

export type OrganizationMemberStatus = 'invited' | 'active' | 'suspended' | 'removed'

/** organization_members — THE person <-> organization bridge every organization-scoped authorization check reads (via src/lib/rbac.ts). */
export interface OrganizationMemberRow {
  id: number
  organization_id: number
  user_id: number
  role_id: number
  status: OrganizationMemberStatus
  is_owner: number
  invited_by_user_id: number | null
  joined_at: string | null
  removed_at: string | null
  created_at: string
  updated_at: string
}

export type OrganizationInvitationStatus = 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired'

/** organization_invitations — Section 16's invite lifecycle. token_hash is the SHA-256 of the raw invite token, same never-store-raw pattern as sessions.token_hash. */
export interface OrganizationInvitationRow {
  id: number
  organization_id: number
  role_id: number
  invited_email: string | null
  invited_phone: string | null
  invited_by_user_id: number
  token_hash: string
  status: OrganizationInvitationStatus
  expires_at: string
  accepted_by_user_id: number | null
  accepted_at: string | null
  created_at: string
}

export type OrganizationAddressType = 'business' | 'billing' | 'shipping' | 'pickup' | 'service'

/** organization_addresses — reusable across every vertical (Section 11), distinct from the personal `addresses` table. Country-neutral (Section 12): country_iso + lat/lng from day one. */
export interface OrganizationAddressRow {
  id: number
  organization_id: number
  address_type: OrganizationAddressType
  label: string
  recipient_name: string
  phone: string
  line1: string
  line2: string | null
  city: string
  state_region: string | null
  postal_code: string | null
  country_iso: string
  latitude: number | null
  longitude: number | null
  is_default: number
  created_at: string
  updated_at: string
}

// ============================================================
// Service Engine 2.0 (migration 0039)
// ============================================================

/** provider_profiles (migration 0025), reused as-is for Service Engine providers. provider_type is always 'gig_provider' for services; primary_category_id/identity_organization_id are additive (migration 0039). */
export interface ProviderProfileRow {
  id: number
  user_id: number
  provider_type: 'gig_provider' | 'host' | 'driver_operator' | 'restaurant_operator'
  organization_id: number | null
  identity_organization_id: number | null
  primary_category_id: number | null
  display_name: string
  bio: string
  contact_email: string | null
  contact_phone: string | null
  country_iso: string
  service_area_json: string
  verification_status: 'pending' | 'verified' | 'rejected'
  operational_status: 'active' | 'paused' | 'suspended'
  onboarding_completed_at: string | null
  rating_avg: number
  rating_count: number
  metadata_json: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export type ServiceListingStatus = 'draft' | 'pending_review' | 'active' | 'paused' | 'rejected' | 'archived'
export type ServiceType = 'at_provider_location' | 'at_customer_location' | 'online' | 'mobile' | 'remote' | 'hybrid' | 'in_person'
export type ServicePricingModel = 'fixed' | 'starting_price' | 'hourly' | 'daily' | 'per_visit' | 'per_session' | 'per_km' | 'per_sqm' | 'custom_quote' | 'price_range' | 'negotiable'

export interface ServiceListingRow {
  id: number
  provider_profile_id: number
  bookable_listing_id: number | null
  category_id: number
  title: string
  description: string
  service_type: ServiceType
  pricing_model: ServicePricingModel
  base_price_kobo: number | null
  max_price_kobo: number | null
  currency: string
  duration_minutes: number | null
  requirements_json: string
  media_json: string
  terms: string
  cancellation_policy: string
  status: ServiceListingStatus
  is_active: number
  rating_avg: number
  rating_count: number
  created_at: string
  updated_at: string
  // joined convenience fields
  category_name?: string
  category_slug?: string
  provider_display_name?: string
  provider_rating_avg?: number
  provider_verification_status?: string
}

export interface ServicePackageRow {
  id: number
  service_listing_id: number
  title: string
  description: string
  price_kobo: number
  duration_minutes: number | null
  included_json: string
  limits_json: string
  sort_order: number
  is_active: number
  created_at: string
}

export interface ServiceAreaRow {
  id: number
  provider_profile_id: number
  country_iso: string
  region: string | null
  city: string | null
  neighborhood: string | null
  radius_km: number | null
  latitude: number | null
  longitude: number | null
  is_online_only: number
  created_at: string
}

export interface ServiceResourceRow {
  id: number
  provider_profile_id: number
  name: string
  role_title: string | null
  is_active: number
  created_at: string
}

export interface ServiceAvailabilityHourRow {
  id: number
  resource_id: number
  day_of_week: number
  start_time: string
  end_time: string
  buffer_minutes: number
  is_active: number
}

export type ServiceRequestStatus = 'draft' | 'submitted' | 'matching' | 'quoted' | 'accepted' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'disputed'
export type ServiceUrgency = 'normal' | 'urgent' | 'emergency'

export interface ServiceRequestRow {
  id: number
  request_number: string
  customer_user_id: number
  category_id: number
  service_listing_id: number | null
  title: string
  description: string
  country_iso: string
  city: string | null
  address_line1: string | null
  latitude: number | null
  longitude: number | null
  preferred_date: string | null
  preferred_time: string | null
  budget_kobo: number | null
  urgency: ServiceUrgency
  status: ServiceRequestStatus
  created_at: string
  updated_at: string
}

export interface ServiceRequestRequirementRow {
  id: number
  service_request_id: number
  key: string
  label: string
  value: string | null
}

export interface ServiceRequestAttachmentRow {
  id: number
  service_request_id: number
  url: string
  media_type: string
  created_at: string
}

export type ServiceQuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired' | 'withdrawn'

export interface ServiceQuoteRow {
  id: number
  service_request_id: number
  provider_profile_id: number
  price_kobo: number
  currency: string
  estimated_duration_minutes: number | null
  proposed_date: string | null
  proposed_time: string | null
  scope: string
  materials_included: number
  travel_fee_kobo: number
  notes: string
  status: ServiceQuoteStatus
  expires_at: string | null
  version: number
  supersedes_quote_id: number | null
  created_at: string
  updated_at: string
  // joined convenience fields
  provider_display_name?: string
  provider_rating_avg?: number
}

export type ServiceOrderStatus =
  | 'accepted'
  | 'scheduled'
  | 'provider_arriving'
  | 'in_progress'
  | 'completed'
  | 'customer_confirmed'
  | 'paid'
  | 'cancelled'
  | 'declined'
  | 'expired'
  | 'disputed'
  | 'refunded'
  | 'no_show'

export interface ServiceOrderRow {
  id: number
  order_number: string
  service_request_id: number
  service_quote_id: number
  customer_user_id: number
  provider_profile_id: number
  booking_id: number | null
  price_kobo: number
  travel_fee_kobo: number
  additional_charges_kobo: number
  platform_fee_kobo: number
  total_kobo: number
  currency: string
  payment_status: 'unpaid' | 'deposit_paid' | 'escrow_held' | 'released' | 'refunded' | 'partially_refunded'
  status: ServiceOrderStatus
  scheduled_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  created_at: string
  updated_at: string
}

export interface ServiceOrderEventRow {
  id: number
  service_order_id: number
  previous_status: string | null
  new_status: string
  actor_user_id: number | null
  metadata_json: string
  created_at: string
}

export interface ServiceMediaRow {
  id: number
  provider_profile_id: number | null
  service_listing_id: number | null
  media_type: string
  url: string
  caption: string | null
  media_category: string
  sort_order: number
  created_at: string
}

/** bookable_listings (migration 0024), reused as-is by the Service Engine — service_listing_id is additive (migration 0039). */
export interface BookableListingRow {
  id: number
  listing_type: 'gig_service' | 'stay_unit'
  provider_user_id: number
  title: string
  description: string
  country_iso: string
  city: string | null
  booking_mode: 'instant' | 'request'
  pricing_unit: 'per_booking' | 'per_hour' | 'per_night'
  base_price_kobo: number
  currency: string
  is_active: number
  category: string | null
  cover_image_url: string | null
  service_listing_id: number | null
  created_at: string
  updated_at: string
}

/** bookings (migration 0024), reused as-is. */
export interface BookingRow {
  id: number
  booking_number: string
  listing_id: number
  listing_type_snapshot: string
  customer_user_id: number
  provider_user_id: number
  starts_at: string
  ends_at: string
  guests_count: number | null
  total_price_kobo: number
  currency: string
  payment_status: 'unpaid' | 'escrow_held' | 'released' | 'refunded'
  payment_reference: string | null
  status: 'pending_request' | 'confirmed' | 'declined' | 'cancelled' | 'completed' | 'no_show'
  cancelled_reason: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Marketplace Engine 2.0 (migration 0038)
// ============================================================

/** product_pricing_tiers — optional, additive bulk/wholesale pricing per listing (spec section 11). Zero rows = the listing behaves exactly as flat-price_kobo retail. */
export interface PricingTierRow {
  id: number
  listing_id: number
  min_quantity: number
  max_quantity: number | null
  unit_price_kobo: number
  tier_label: string | null
  sort_order: number
  is_active: number
  created_at: string
}

/** inventory_adjustments — append-only stock movement ledger (spec section 9/37). */
export type InventoryAdjustmentReason =
  | 'order_placed'
  | 'order_cancelled'
  | 'payment_failed'
  | 'fulfilled'
  | 'returned'
  | 'manual_adjustment'
  | 'restock'

export interface InventoryAdjustmentRow {
  id: number
  listing_id: number
  variant_id: number | null
  delta: number
  reason: InventoryAdjustmentReason
  order_id: number | null
  actor_user_id: number | null
  note: string | null
  stock_after: number
  created_at: string
}

/** category_attributes — dynamic, category-associated product attribute schema (spec section 7). */
export type AttributeDataType = 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
export type AttributeRequirement = 'required' | 'optional' | 'recommended' | 'conditional'

export interface CategoryAttributeRow {
  id: number
  category_id: number
  key: string
  label: string
  data_type: AttributeDataType
  options_json: string | null
  requirement: AttributeRequirement
  condition_json: string | null
  sort_order: number
  created_at: string
}

/** product_attribute_values — one product's value for one category attribute. */
export interface ProductAttributeValueRow {
  id: number
  product_id: number
  attribute_id: number
  value: string
  // joined convenience fields (when queried with a JOIN on category_attributes)
  key?: string
  label?: string
  data_type?: AttributeDataType
}

/** collections — merchandising/Africa-first taxonomy groupings, SEPARATE from category/brand taxonomy (spec section 26). */
export type CollectionType = 'merchandising' | 'africa_first' | 'seasonal' | 'editorial'

export interface CollectionRow {
  id: number
  slug: string
  name: string
  description: string
  collection_type: CollectionType
  is_active: number
  sort_order: number
  created_at: string
}

/** product_collections — many-to-many join between products and collections. */
export interface ProductCollectionRow {
  id: number
  collection_id: number
  product_id: number
  sort_order: number
  added_at: string
}

/** Product moderation states, shared by products.moderation_status and product_listings.moderation_status. Not a DB CHECK constraint (kept extensible per vertical), but this is the canonical application-level enum. */
export type ModerationStatus = 'draft' | 'pending_review' | 'active' | 'paused' | 'rejected' | 'archived'

/** Fuller order-item fulfillment lifecycle (spec section 18), stored in the existing order_items.item_status column. */
export type OrderItemStatus =
  | 'processing'
  | 'fulfilled'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'returned'
  | 'disputed'
