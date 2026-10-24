import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTIVE_NAIJADRIVE_ZONES, validateDrivePreviewBooking } from '../src/lib/drive-preview.ts'

test('NaijaDrive preview accepts only configured Abuja pilot zones', () => {
  assert.deepEqual(ACTIVE_NAIJADRIVE_ZONES, ['abuja-central', 'gwarinpa', 'lokogoma'])
  assert.deepEqual(validateDrivePreviewBooking({ pickupZone: 'abuja-central', dropoffZone: 'gwarinpa' }), { ok: true })
})

test('NaijaDrive preview rejects missing and unsupported locations without persistence', () => {
  assert.deepEqual(validateDrivePreviewBooking(null), { ok: false, status: 400, error: 'Choose both a pickup and destination zone.' })
  assert.deepEqual(validateDrivePreviewBooking({ pickupZone: 'airport-axis', dropoffZone: 'gwarinpa' }), { ok: false, status: 400, error: 'That location is outside the active Abuja pilot zones.' })
})
