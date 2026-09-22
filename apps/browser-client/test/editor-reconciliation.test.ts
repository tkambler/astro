import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldAdoptIncomingDraft } from '../src/notes/editing/index.ts'

const draft = { title: 'Current title', body: 'Current body' }

test('editor reconciliation rejects stale snapshots while a local save is in flight', () => {
  assert.equal(shouldAdoptIncomingDraft({ title: 'Old title', body: 'Old body', revision: 4, dirty: false }, draft, 4, 1), false)
})

test('editor reconciliation rejects differing snapshots at the already-applied revision', () => {
  assert.equal(shouldAdoptIncomingDraft({ title: 'Old title', body: 'Old body', revision: 4, dirty: false }, draft, 4, 0), false)
})

test('editor reconciliation accepts a genuinely newer clean server revision', () => {
  assert.equal(shouldAdoptIncomingDraft({ ...draft, body: 'Remote body', revision: 5, dirty: false }, draft, 4, 0), true)
})

test('editor reconciliation never replaces the draft with a dirty local snapshot', () => {
  assert.equal(shouldAdoptIncomingDraft({ ...draft, body: 'Stored draft', revision: 5, dirty: true }, draft, 4, 0), false)
})
