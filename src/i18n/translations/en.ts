// NaijaDeals — English (en) — CANONICAL SOURCE DICTIONARY
//
// This is the source of truth every other language is translated FROM. Do
// not rewrite existing English copy unnecessarily — these strings mirror the
// literal text already live in Layout.tsx / components / pages at the time
// this dictionary was created (Task N). When new UI copy is added anywhere
// in the app, add the key here FIRST, in English, then propagate to the
// other 9 live dictionaries.

import type { TranslationDict } from '../types'

export const en: TranslationDict = {
  // Navigation
  nav_home: 'Home',
  nav_shop: 'Shop',
  nav_fresh: 'Fresh',
  nav_eats: 'Eats',
  nav_gigs: 'Gigs',
  nav_stay: 'Stay',
  nav_drive: 'Drive',
  nav_send: 'Send',
  nav_stream: 'Stream',
  nav_aura: 'Aura AI',
  nav_sell_on_naijadeals: 'Sell on NaijaDeals',
  nav_account: 'Account',
  nav_cart: 'Cart',
  nav_wishlist: 'Wishlist',
  nav_search: 'Search',
  nav_categories: 'Categories',
  nav_deals: "Today's Deals",
  nav_all: 'All',
  nav_help_center: 'Help Center',
  nav_orders_returns: 'Returns & Orders',
  nav_balance: 'Balance',
  nav_hello_sign_in: 'Hello, sign in',
  nav_deliver_to: 'Deliver to',

  // Ecosystem vertical brand names (kept in English/brand form across
  // languages by design — see docs/I18N.md "brand names are not translated")
  eco_naijashop: 'NaijaShop',
  eco_naijafresh: 'NaijaFresh',
  eco_naijaeats: 'NaijaEats',
  eco_naijagigs: 'NaijaGigs',
  eco_naijastay: 'NaijaStay',
  eco_naijadrive: 'NaijaDrive',
  eco_naijasend: 'NaijaSend',
  eco_naijastream: 'NaijaStream',
  eco_aura_ai: 'Aura AI',

  // Preview / Coming Soon
  preview_coming_soon: 'Coming Soon',
  preview_available_in_city_soon: 'Available in your city soon',
  preview_join_waitlist: 'Join the waitlist',
  preview_learn_more: 'Learn More',
  preview_coming_to_your_city: 'Coming to your city',
  preview_be_first_to_know: 'Be the first to know',
  preview_soon_badge: 'Soon',

  // Commerce
  commerce_add_to_cart: 'Add to Cart',
  commerce_buy_now: 'Buy Now',
  commerce_checkout: 'Checkout',
  commerce_continue_shopping: 'Continue Shopping',
  commerce_quantity: 'Quantity',
  commerce_price: 'Price',
  commerce_total: 'Total',
  commerce_subtotal: 'Subtotal',
  commerce_delivery: 'Delivery',
  commerce_payment: 'Payment',
  commerce_order: 'Order',
  commerce_orders: 'Orders',
  commerce_available: 'Available',
  commerce_out_of_stock: 'Out of Stock',
  commerce_today_deals: "Today's Deals",

  // Forms
  form_name: 'Name',
  form_full_name: 'Full name',
  form_email: 'Email',
  form_phone: 'Phone',
  form_country: 'Country',
  form_state: 'State',
  form_city: 'City',
  form_submit: 'Submit',
  form_cancel: 'Cancel',
  form_save: 'Save',
  form_continue: 'Continue',
  form_back: 'Back',
  form_required_field: 'Required field',
  form_something_went_wrong: 'Something went wrong',

  // Auth
  auth_login: 'Login',
  auth_sign_up: 'Sign Up',
  auth_logout: 'Logout',
  auth_forgot_password: 'Forgot Password',
  auth_create_account: 'Create Account',
  auth_hello_greeting: 'Hello, {name}',

  // Waitlist
  waitlist_title: 'Join the NaijaDeals waitlist',
  waitlist_success_title: "You're on the list!",
  waitlist_select_at_least_one_service: 'Please select at least one service.',
  waitlist_submit_btn: 'Join Waitlist',

  // Footer
  footer_get_to_know_us: 'Get to Know Us',
  footer_customer_service: 'Customer Service',
  footer_payments_delivery: 'Payments & Delivery',
  footer_ecosystem: 'Ecosystem',
  footer_policies: 'Policies',
  footer_trust_safety: 'Trust & Safety',
  footer_newsletter_heading: 'New to NaijaDeals?',
  footer_newsletter_body: 'Subscribe for updates on the latest offers, deals and ecosystem launches.',
  footer_rights: '© 2026 NaijaDeals. All rights reserved. A Nigerian digital commerce ecosystem.',

  // Misc
  misc_language_coming_soon_notice: 'This language is coming soon. Showing English for now.',
}
