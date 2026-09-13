-- ============================================================
-- Migration 0049: Engine 1 Identity Completion — notification templates
-- ============================================================
-- Seeds notification_templates rows for the two new Engine 9 event types
-- Priority 2 (password reset) and Priority 3 (email/phone verification)
-- introduce. Without these rows, renderTemplate() still works (it has an
-- honest fallback — event_type as subject, empty body) but a
-- security-sensitive email/SMS with an empty body is a poor user
-- experience, so real templates are seeded exactly like every other
-- event_type in migration 0046.
--
-- {{reset_url}} / {{verify_url}} are FULL URLs (including the raw,
-- one-time token as a query param) built by the route layer
-- (src/routes/api-auth.ts) at enqueue time — the template layer only
-- interpolates, never generates or has access to unhashed tokens itself
-- beyond what is explicitly passed in payload.

INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('password_reset_requested', 'in_app', 'en', 1, 'Password reset requested', 'A password reset was requested for your account. If this was not you, you can ignore this — your password will not change unless you use the link we emailed you.', NULL, 1),
  ('password_reset_requested', 'email', 'en', 1, 'Reset your Naijadeals password', 'Hi {{name}},

We received a request to reset your Naijadeals password. This link is valid for a limited time and can only be used once:

{{reset_url}}

If you did not request this, you can safely ignore this email — your password will not change.', '{{reset_url}}', 1);

INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('password_reset_completed', 'in_app', 'en', 1, 'Password changed', 'Your Naijadeals password was just changed. If this was not you, contact support immediately.', '/account', 1),
  ('password_reset_completed', 'email', 'en', 1, 'Your Naijadeals password was changed', 'Hi {{name}},

Your password was just successfully changed. If you did not make this change, please contact support immediately and secure your account.', NULL, 1);

INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('email_verification_requested', 'in_app', 'en', 1, 'Verify your email', 'Please verify your email address to unlock all account features.', NULL, 1),
  ('email_verification_requested', 'email', 'en', 1, 'Verify your Naijadeals email address', 'Hi {{name}},

Please confirm your email address by visiting the link below. This link is valid for a limited time:

{{verify_url}}', '{{verify_url}}', 1);

INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active) VALUES
  ('phone_verification_requested', 'in_app', 'en', 1, 'Verify your phone number', 'Please verify your phone number to unlock all account features.', NULL, 1),
  ('phone_verification_requested', 'sms', 'en', 1, NULL, 'Your Naijadeals verification code is {{code}}. It expires shortly and can only be used once.', NULL, 1);
