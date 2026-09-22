import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'

class MemoryStorage implements Storage {
  #values = new Map<string, string>()
  get length() { return this.#values.size }
  clear() { this.#values.clear() }
  getItem(key: string) { return this.#values.get(key) ?? null }
  key(index: number) { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string) { this.#values.delete(key) }
  setItem(key: string, value: string) { this.#values.set(key, value) }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage() })
Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined })

test('native IndexedDB storage preserves workspace, sync, attachment, and trash behavior', async () => {
  const local = await import('../src/notes/local/index.ts')
  const originalId = local.newIdentifier()
  await local.saveNote(originalId, 'Guest note', 'offline body', false, undefined, ['local'])
  assert.deepEqual((await local.listNotes()).map(note => note.title), ['Guest note'])
  assert.equal((await local.listNotes())[0]?.collection, 'Notes')

  await local.activateAccount('account-1')
  const [moved] = await local.listNotes()
  assert.ok(moved)
  assert.notEqual(moved.id, originalId)
  assert.equal(moved.body, 'offline body')
  assert.equal((await local.pendingMutations()).length, 1)

  const attachment = { id: local.newIdentifier(), noteId: moved.id, filename: 'photo.png', mediaType: 'image/png',
    byteSize: 123, sha256: 'abc', createdAt: '2026-01-01T00:00:00.000Z' }
  await local.saveLocalAttachment(attachment)
  assert.deepEqual(await local.listLocalAttachments(moved.id), [attachment])

  await local.setCursor(42)
  assert.equal(await local.getCursor(), 42)
  await local.receiveNote({ id: local.newIdentifier(), collection: 'Work', title: 'Remote note', body: 'server body', tags: ['remote'],
    pinned: false, purged: false, revision: 1, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: null })
  assert.deepEqual((await local.listNotes('', 'title')).map(note => note.title), ['Guest note', 'Remote note'])

  await local.saveNote(moved.id, moved.title, moved.body, true, undefined, moved.tags)
  assert.equal((await local.listTrash()).length, 1)
  assert.equal(await local.restoreNote(moved.id), true)
  assert.equal((await local.listTrash()).length, 0)

  await local.saveNote(moved.id, moved.title, moved.body, true, undefined, moved.tags)
  const emptied = await local.emptyTrash()
  assert.deepEqual(emptied, { count: 1, attachmentIds: [attachment.id] })
  assert.deepEqual(await local.listLocalAttachments(moved.id), [])
})
