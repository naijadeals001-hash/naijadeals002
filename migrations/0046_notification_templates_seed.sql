-- Engine 9, Phase 9: authored templates for the 5 real event writers'
-- actual event_type values (see src/lib/order-lifecycle.ts,
-- booking-lifecycle.ts, orders.ts, refunds.ts, api-auth.ts — grep'd
-- directly, not guessed). Covers in_app + email for every event_type this
-- codebase can actually produce today. No unsupported event data is
-- referenced — every {{token}} below matches a real payload key from the
-- corresponding event writer.
--
-- version=1 for every row (first authored version). Locale='en' (the
-- only locale seeded anywhere in this repo per the Phase 1 audit — no
-- i18n engine to integrate with; documented as a known limitation, not
-- duplicated here).
--
-- SAFETY: body/subject content here is AUTHOR-CONTROLLED (this migration
-- file), never user-controlled — interpolate() in notification-templates.ts
-- still HTML-escapes every {{token}} substitution regardless.

-- account_registered
INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('account_registered', 'in_app', 'en', 1, 'Welcome to Naijadeals!', 'Hi {{name}}, your account is ready. Start exploring deals near you.', '/account', 1),
  ('account_registered', 'email', 'en', 1, 'Welcome to Naijadeals, {{name}}!', 'Hi {{name}},

Thanks for creating an account with Naijadeals. You can now shop, track orders, and manage your wallet from your dashboard.

- The Naijadeals Team', '/account', 1);

-- payment_confirmed
INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('payment_confirmed', 'in_app', 'en', 1, 'Payment received', 'Your payment for order #{{order_id}} has been confirmed. We are preparing your order.', '/orders/{{order_id}}', 1),
  ('payment_confirmed', 'email', 'en', 1, 'Payment confirmed for order #{{order_id}}', 'Hi,

We have received your payment for order #{{order_id}}. Your order is now being prepared for fulfillment.

Thank you for shopping with Naijadeals.', '/orders/{{order_id}}', 1);

-- refund_completed
INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('refund_completed', 'in_app', 'en', 1, 'Refund completed', 'A refund for order #{{order_id}} has been credited to your wallet.', '/orders/{{order_id}}', 1),
  ('refund_completed', 'email', 'en', 1, 'Your refund for order #{{order_id}} is complete', 'Hi,

Your refund for order #{{order_id}} has been processed and credited to your Naijadeals wallet.
Reason: {{reason}}

- The Naijadeals Team', '/orders/{{order_id}}', 1);

-- order_item_shipped / delivered / completed / cancelled / refunded / partially_refunded
INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('order_item_shipped', 'in_app', 'en', 1, 'Your item has shipped', 'An item from order #{{order_id}} is on its way to you.', '/orders/{{order_id}}', 1),
  ('order_item_shipped', 'email', 'en', 1, 'Your order #{{order_id}} has shipped', 'Hi,

Good news — an item from your order #{{order_id}} has shipped and is on its way.

- The Naijadeals Team', '/orders/{{order_id}}', 1),

  ('order_item_delivered', 'in_app', 'en', 1, 'Item delivered', 'An item from order #{{order_id}} has been marked delivered.', '/orders/{{order_id}}', 1),
  ('order_item_delivered', 'email', 'en', 1, 'Your order #{{order_id}} has been delivered', 'Hi,

An item from your order #{{order_id}} has been delivered. We hope you enjoy it!

- The Naijadeals Team', '/orders/{{order_id}}', 1),

  ('order_item_completed', 'in_app', 'en', 1, 'Order completed', 'Order #{{order_id}} is now complete.', '/orders/{{order_id}}', 1),
  ('order_item_completed', 'email', 'en', 1, 'Order #{{order_id}} completed', 'Hi,

Your order #{{order_id}} is now marked complete. Thank you for shopping with Naijadeals.

- The Naijadeals Team', '/orders/{{order_id}}', 1),

  ('order_item_cancelled', 'in_app', 'en', 1, 'Item cancelled', 'An item from order #{{order_id}} was cancelled.', '/orders/{{order_id}}', 1),
  ('order_item_cancelled', 'email', 'en', 1, 'An item in order #{{order_id}} was cancelled', 'Hi,

An item from your order #{{order_id}} has been cancelled. If a payment was made for this item, any applicable refund will be processed separately.

- The Naijadeals Team', '/orders/{{order_id}}', 1),

  ('order_item_refunded', 'in_app', 'en', 1, 'Item refunded', 'An item from order #{{order_id}} was refunded.', '/orders/{{order_id}}', 1),
  ('order_item_refunded', 'email', 'en', 1, 'An item in order #{{order_id}} was refunded', 'Hi,

An item from your order #{{order_id}} has been refunded. Please check your wallet balance for the credited amount.

- The Naijadeals Team', '/orders/{{order_id}}', 1),

  ('order_item_partially_refunded', 'in_app', 'en', 1, 'Item partially refunded', 'An item from order #{{order_id}} was partially refunded.', '/orders/{{order_id}}', 1),
  ('order_item_partially_refunded', 'email', 'en', 1, 'A partial refund was issued for order #{{order_id}}', 'Hi,

An item from your order #{{order_id}} received a partial refund. Please check your wallet balance for the credited amount.

- The Naijadeals Team', '/orders/{{order_id}}', 1);

-- booking_confirmed / checked_in / completed / cancelled / declined / expired / no_show / disputed
INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('booking_confirmed', 'in_app', 'en', 1, 'Booking confirmed', 'Your booking {{booking_number}} has been confirmed.', '/bookings/{{booking_id}}', 1),
  ('booking_confirmed', 'email', 'en', 1, 'Booking {{booking_number}} confirmed', 'Hi,

Your booking {{booking_number}} has been confirmed. We look forward to seeing you.

- The Naijadeals Team', '/bookings/{{booking_id}}', 1),

  ('booking_checked_in', 'in_app', 'en', 1, 'Checked in', 'You have been checked in for booking {{booking_number}}.', '/bookings/{{booking_id}}', 1),
  ('booking_checked_in', 'email', 'en', 1, 'Checked in for booking {{booking_number}}', 'Hi,

You have been successfully checked in for booking {{booking_number}}.

- The Naijadeals Team', '/bookings/{{booking_id}}', 1),

  ('booking_completed', 'in_app', 'en', 1, 'Booking completed', 'Your booking {{booking_number}} is now complete.', '/bookings/{{booking_id}}', 1),
  ('booking_completed', 'email', 'en', 1, 'Booking {{booking_number}} completed', 'Hi,

Your booking {{booking_number}} is now complete. Thank you for using Naijadeals.

- The Naijadeals Team', '/bookings/{{booking_id}}', 1),

  ('booking_cancelled', 'in_app', 'en', 1, 'Booking cancelled', 'Your booking {{booking_number}} was cancelled.', '/bookings/{{booking_id}}', 1),
  ('booking_cancelled', 'email', 'en', 1, 'Booking {{booking_number}} cancelled', 'Hi,

Your booking {{booking_number}} has been cancelled. If applicable, any refund will follow this booking''s cancellation policy.

- The Naijadeals Team', '/bookings/{{booking_id}}', 1),

  ('booking_declined', 'in_app', 'en', 1, 'Booking declined', 'Your booking request {{booking_number}} was declined.', '/bookings/{{booking_id}}', 1),
  ('booking_declined', 'email', 'en', 1, 'Booking request {{booking_number}} declined', 'Hi,

Unfortunately your booking request {{booking_number}} was declined by the provider.

- The Naijadeals Team', '/bookings/{{booking_id}}', 1),

  ('booking_expired', 'in_app', 'en', 1, 'Booking expired', 'Your booking hold {{booking_number}} expired before confirmation.', '/bookings/{{booking_id}}', 1),
  ('booking_expired', 'email', 'en', 1, 'Booking hold {{booking_number}} expired', 'Hi,

Your booking hold {{booking_number}} expired before it could be confirmed. Feel free to book again.

- The Naijadeals Team', '/bookings/{{booking_id}}', 1),

  ('booking_no_show', 'in_app', 'en', 1, 'Marked as no-show', 'Booking {{booking_number}} was marked as a no-show.', '/bookings/{{booking_id}}', 1),
  ('booking_no_show', 'email', 'en', 1, 'Booking {{booking_number}} marked as no-show', 'Hi,

Your booking {{booking_number}} was marked as a no-show by the provider.

- The Naijadeals Team', '/bookings/{{booking_id}}', 1),

  ('booking_disputed', 'in_app', 'en', 1, 'Booking disputed', 'A dispute was opened for booking {{booking_number}}.', '/bookings/{{booking_id}}', 1),
  ('booking_disputed', 'email', 'en', 1, 'Dispute opened for booking {{booking_number}}', 'Hi,

A dispute has been opened regarding your booking {{booking_number}}. Our team will review it shortly.

- The Naijadeals Team', '/bookings/{{booking_id}}', 1);
