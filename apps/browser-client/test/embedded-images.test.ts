import { test } from 'node:test'
import assert from 'node:assert/strict'
import { embeddedImageId, embeddedImageSource } from '../src/attachments/references.ts'

test('embedded image references contain only stable attachment identifiers', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000'
  assert.equal(embeddedImageSource(id), `attachment:${id}`)
  assert.equal(embeddedImageId(`attachment:${id}`), id)
  assert.equal(embeddedImageId('https://example.test/tracker.png'), null)
  assert.equal(embeddedImageId('attachment:../../private'), null)
})
