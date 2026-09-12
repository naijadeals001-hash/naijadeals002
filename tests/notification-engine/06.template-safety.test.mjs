/**
 * Engine 9 — Category E (template rendering safety), direct-library mode.
 * Exercises src/lib/notification-templates.ts's interpolate()/renderTemplate()
 * directly — this is the correct layer to prove the safe-interpolation
 * contract (unknown key -> '', HTML-escaping, no eval, honest fallback for
 * a missing template row) since there is no 1:1 HTTP endpoint for template
 * rendering itself (09.api-security.test.mjs already proves this contract
 * holds end-to-end through a REAL event-writer path; this file adds the
 * focused unit-level proof of every individual safety property).
 *
 * PRECONDITION: PM2 dev server STOPPED (direct-lib mode — see
 * helpers/direct-db.mjs's header comment).
 * Run command:
 *   node --experimental-strip-types --experimental-loader ./tests/payment-engine/helpers/ts-extensionless-loader.mjs --test tests/notification-engine/06.template-safety.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTestDb, disposeTestDb } from './helpers/direct-db.mjs'
import { interpolate, renderTemplate, createTemplateVersion } from '../../src/lib/notification-templates.ts'

test.after(async () => {
  await disposeTestDb()
})

test('template safety: normal interpolation replaces every known {{key}} with its value', () => {
  const out = interpolate('Hello {{name}}, your order #{{order_id}} is ready.', { name: 'Ada', order_id: 42 })
  assert.equal(out, 'Hello Ada, your order #42 is ready.')
})

test('template safety: an unknown/undeclared key renders as empty string, never "undefined" or a thrown error', () => {
  const out = interpolate('Hello {{name}}, code {{unknown_var}} done.', { name: 'Ada' })
  assert.equal(out, 'Hello Ada, code  done.')
  assert.ok(!out.includes('undefined'))
})

test('template safety: a null or undefined payload value for a known key renders as empty string, not the literal "null"/"undefined"', () => {
  const out = interpolate('Value: {{x}} and {{y}}', { x: null, y: undefined })
  assert.equal(out, 'Value:  and ')
})

test('template safety: every interpolated VALUE is HTML-escaped — a malicious payload value can never inject a live tag', () => {
  const out = interpolate('Note: {{note}}', { note: '<script>alert(1)</script>' })
  assert.ok(!out.includes('<script>'), 'must never contain a raw <script> tag')
  assert.equal(out, 'Note: &lt;script&gt;alert(1)&lt;/script&gt;')
})

test('template safety: single/double quotes in an interpolated value are escaped (closes attribute-context injection if ever rendered inside an HTML attribute)', () => {
  const out = interpolate('Value: {{v}}', { v: `"onmouseover="alert(1)` + `'x'` })
  assert.ok(!out.includes('"'), 'raw double-quote must never survive interpolation')
  assert.ok(!out.includes("'"), 'raw single-quote must never survive interpolation')
})

test('template safety: the TEMPLATE STRING itself is never evaluated as code — no eval/Function, a template containing {{__proto__}} or JS-looking syntax is treated as plain text', () => {
  const out = interpolate('{{__proto__}} {{constructor}} process.exit()', { __proto__: 'x', constructor: 'y' })
  // __proto__/constructor are just ordinary object property lookups on a
  // plain object here (not prototype-polluting) — the key point is the
  // literal "process.exit()" text is NEVER executed, just passed through
  // as static text since it isn't a {{token}}.
  assert.ok(out.includes('process.exit()'), 'non-token text must pass through completely unexecuted, unchanged')
})

test('template safety: malformed/unclosed {{ token is left as literal text, never throws', () => {
  const out = interpolate('Broken {{name token here', { name: 'Ada' })
  assert.equal(out, 'Broken {{name token here', 'an unclosed {{ must never match the token regex, and must never throw')
})

test('template safety: renderTemplate falls back to an honest minimal rendering when no active template row exists for (event_type, channel, locale) — never throws, never blocks delivery', async () => {
  const db = await getTestDb()
  const rendered = await renderTemplate(db, 'totally_unknown_event_type_xyz', 'in_app', { foo: 'bar' })
  assert.equal(rendered.subject, 'totally unknown event type xyz')
  assert.equal(rendered.body, '')
  assert.equal(rendered.actionUrl, null)
})

test('template safety: renderTemplate correctly interpolates a REAL seeded template (payment_confirmed/in_app) against a real payload', async () => {
  const db = await getTestDb()
  const rendered = await renderTemplate(db, 'payment_confirmed', 'in_app', { order_id: 12345 })
  assert.ok(rendered.subject)
  assert.ok(rendered.body.includes('12345'), `expected order_id interpolated into the body: ${rendered.body}`)
  assert.ok(rendered.actionUrl.includes('12345'), `expected order_id interpolated into the action url: ${rendered.actionUrl}`)
})

test('template safety: createTemplateVersion registers a NEW version rather than mutating an existing one in place, and versions increment monotonically', async () => {
  const db = await getTestDb()
  const eventType = `test_versioning_event_${Date.now()}`
  const v1 = await createTemplateVersion(db, { eventType, channel: 'in_app', bodyTemplate: 'v1 body {{x}}' })
  const v2 = await createTemplateVersion(db, { eventType, channel: 'in_app', bodyTemplate: 'v2 body {{x}}' })
  assert.notEqual(v1, v2, 'each createTemplateVersion call must create a NEW row, never update in place')

  // renderTemplate must pick the LATEST (highest version) active row.
  const rendered = await renderTemplate(db, eventType, 'in_app', { x: 'hello' })
  assert.equal(rendered.body, 'v2 body hello', 'renderTemplate must select the highest version, not the first-created one')
})
