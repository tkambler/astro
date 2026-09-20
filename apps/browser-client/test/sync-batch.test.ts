import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NoteMutation } from '@astronote/schemas'
import { nextPushBatch } from '../src/notes/sync/batch.ts'

function mutation(index: number, body = ''): NoteMutation {
  return { mutationId: crypto.randomUUID(), id: crypto.randomUUID(), baseRevision: 0,
    title: `Note ${index}`, body, tags: [], deleted: false }
}

test('push batches keep their order and stay within count limit', () => {
  const pending = Array.from({ length: 26 }, (_, index) => mutation(index))
  const batch = nextPushBatch(pending)
  assert.deepEqual(batch.mutations, pending.slice(0, 25))
  assert.deepEqual(JSON.parse(batch.body), { mutations: pending.slice(0, 25) })
})

test('push batches stop before exceeding request size and reject an oversized note', () => {
  const large = mutation(0, 'x'.repeat(26 * 1024 * 1024))
  const other = mutation(1, 'x'.repeat(26 * 1024 * 1024))
  assert.deepEqual(nextPushBatch([large, other]).mutations, [large])
  assert.throws(() => nextPushBatch([mutation(2, 'x'.repeat(51 * 1024 * 1024))]), /too large to sync/)
})
