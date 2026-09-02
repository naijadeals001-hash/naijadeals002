// NaijaDeals — i18n Shared Types

import type { LanguageCode } from './languages'

/**
 * Every translatable key in the platform. Deliberately a flat, typed object
 * (not free-form string keys like t('nav.shop')) so a missing translation is
 * a TypeScript compile error in every LIVE dictionary, not a silent runtime
 * gap discovered by a user. Grouped by area only via key naming/comments —
 * TranslationDict itself is one flat Record for simplicity across 10 files.
 */
export interface TranslationDict {
  // ---- Navigation ----
  nav_home: string
  nav_shop: string
  nav_fresh: string
  nav_eats: string
  nav_gigs: string
  nav_stay: string
  nav_drive: string
  nav_send: string
  nav_stream: string
  nav_aura: string
  nav_sell_on_naijadeals: string
  nav_account: string
  nav_cart: string
  nav_wishlist: string
  nav_search: string
  nav_categories: string
  nav_deals: string
  nav_all: string
  nav_help_center: string
  nav_orders_returns: string
  nav_balance: string
  nav_hello_sign_in: string
  nav_deliver_to: string

  // ---- Ecosystem vertical names (brand names — kept but this is where a
  // future translation of TAGLINE text, not the brand itself, would live) ----
  eco_naijashop: string
  eco_naijafresh: string
  eco_naijaeats: string
  eco_naijagigs: string
  eco_naijastay: string
  eco_naijadrive: string
  eco_naijasend: string
  eco_naijastream: string
  eco_aura_ai: string

  // ---- Preview / Coming Soon pages ----
  preview_coming_soon: string
  preview_available_in_city_soon: string
  preview_join_waitlist: string
  preview_learn_more: string
  preview_coming_to_your_city: string
  preview_be_first_to_know: string
  preview_soon_badge: string

  // ---- Commerce ----
  commerce_add_to_cart: string
  commerce_buy_now: string
  commerce_checkout: string
  commerce_continue_shopping: string
  commerce_quantity: string
  commerce_price: string
  commerce_total: string
  commerce_subtotal: string
  commerce_delivery: string
  commerce_payment: string
  commerce_order: string
  commerce_orders: string
  commerce_available: string
  commerce_out_of_stock: string
  commerce_today_deals: string

  // ---- Forms ----
  form_name: string
  form_full_name: string
  form_email: string
  form_phone: string
  form_country: string
  form_state: string
  form_city: string
  form_submit: string
  form_cancel: string
  form_save: string
  form_continue: string
  form_back: string
  form_required_field: string
  form_something_went_wrong: string

  // ---- Auth ----
  auth_login: string
  auth_sign_up: string
  auth_logout: string
  auth_forgot_password: string
  auth_create_account: string
  auth_hello_greeting: string // "Hello, {name}" — {name} replaced at render time

  // ---- Waitlist modal ----
  waitlist_title: string
  waitlist_success_title: string
  waitlist_select_at_least_one_service: string
  waitlist_submit_btn: string

  // ---- Footer ----
  footer_get_to_know_us: string
  footer_customer_service: string
  footer_payments_delivery: string
  footer_ecosystem: string
  footer_policies: string
  footer_trust_safety: string
  footer_newsletter_heading: string
  footer_newsletter_body: string
  footer_rights: string

  // ---- Misc / global ----
  misc_language_coming_soon_notice: string
}

export type TranslationKey = keyof TranslationDict

export interface LocaleContext {
  language: LanguageCode
  /** How the current language was resolved — for debugging + Section 12's language_source contract. */
  source: 'manual' | 'saved' | 'browser' | 'country' | 'default'
  countryCode: string | null
  dir: 'ltr' | 'rtl'
}
