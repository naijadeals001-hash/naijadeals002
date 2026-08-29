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
  sort_order: number
}

export interface VendorRow {
  id: number
  slug: string
  name: string
  description: string | null
  logo_url: string | null
  city: string | null
  is_verified: number
  rating_avg: number
  rating_count: number
}

export interface ProductRow {
  id: number
  slug: string
  vendor_id: number
  category_id: number
  title: string
  description: string
  price_kobo: number
  compare_at_price_kobo: number | null
  currency: string
  stock: number
  image_url: string
  rating_avg: number
  rating_count: number
  is_flash_deal: number
  is_active: number
  return_policy: string
  vendor_name?: string
  vendor_slug?: string
  category_name?: string
  category_slug?: string
}

export interface ReviewRow {
  id: number
  product_id: number
  user_id: number | null
  author_name: string
  rating: number
  comment: string
  created_at: string
}

export interface CartItemRow {
  id: number
  cart_id: number
  product_id: number
  quantity: number
  title: string
  slug: string
  image_url: string
  price_kobo: number
  stock: number
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
  created_at: string
}

export interface OrderItemRow {
  id: number
  order_id: number
  product_id: number
  vendor_id: number
  title_snapshot: string
  image_snapshot: string
  unit_price_kobo: number
  quantity: number
  line_total_kobo: number
}
