import test from 'node:test'
import assert from 'node:assert/strict'
import { orderMigrationFiles } from '../src/infra/migrations.js'
import { assertTtlSeconds, ASSIGNMENT_TTL_SECONDS, PRESENCE_TTL_SECONDS } from '../src/infra/redis-presence.js'

test('orders migrations by numeric prefix, not lexicographic filename order', () => {
  assert.deepEqual(orderMigrationFiles(['10_later.sql', '2_second.sql', '001_first.sql', 'notes.txt']), [
    '001_first.sql',
    '2_second.sql',
    '10_later.sql',
  ])
})

test('rejects duplicate migration prefixes', () => {
  assert.throws(() => orderMigrationFiles(['001_first.sql', '1_duplicate.sql']), /Duplicate migration number: 1/)
})

test('bounds presence and assignment TTLs', () => {
  assert.doesNotThrow(() => assertTtlSeconds(PRESENCE_TTL_SECONDS.min, PRESENCE_TTL_SECONDS, 'Presence TTL'))
  assert.doesNotThrow(() => assertTtlSeconds(ASSIGNMENT_TTL_SECONDS.max, ASSIGNMENT_TTL_SECONDS, 'Assignment TTL'))
  assert.throws(() => assertTtlSeconds(4, PRESENCE_TTL_SECONDS, 'Presence TTL'), /between 5 and 300/)
  assert.throws(() => assertTtlSeconds(901, ASSIGNMENT_TTL_SECONDS, 'Assignment TTL'), /between 5 and 900/)
})
