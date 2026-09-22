import type { Note, NoteMutation } from '@astronote/schemas'
import { announceChange, completed, ownedKey, owner, ready, request, type AttachmentRecord,
  type NoteRecord, type SyncRecord } from './database'
import { newIdentifier } from './identifiers'

function serverRecord(note: Note, ownerId: string): NoteRecord {
  return { ...note, key: ownedKey(ownerId, note.id), ownerId, dirty: false, mutationId: null,
    baseRevision: note.revision, syncedBody: note.body, syncedTitle: note.title }
}

export async function pendingMutations(ownerId = owner()): Promise<NoteMutation[]> {
  const database = await ready()
  const transaction = database.transaction('notes', 'readonly')
  const notes = await request<NoteRecord[]>(transaction.objectStore('notes').index('ownerId').getAll(ownerId))
  await completed(transaction)
  return notes.filter(note => note.dirty).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map(note => ({
    mutationId: note.mutationId!, id: note.id, baseRevision: note.baseRevision, collection: note.collection, title: note.title, body: note.body,
    tags: note.tags, pinned: note.pinned, purged: note.purged, createdAt: note.createdAt,
    updatedAt: note.updatedAt, deleted: !!note.deletedAt,
  }))
}

export async function acceptPush(mutation: NoteMutation, serverNote: Note, ownerId = owner()) {
  const database = await ready()
  const transaction = database.transaction('notes', 'readwrite')
  const store = transaction.objectStore('notes')
  const current = await request<NoteRecord | undefined>(store.get(ownedKey(ownerId, mutation.id)))
  if (current) {
    const unchanged = current.mutationId === mutation.mutationId
    store.put({ ...current, revision: serverNote.revision, baseRevision: serverNote.revision,
      syncedBody: mutation.body, syncedTitle: mutation.title, dirty: unchanged ? false : current.dirty,
      mutationId: unchanged ? null : current.mutationId, updatedAt: unchanged ? serverNote.updatedAt : current.updatedAt })
  }
  await completed(transaction)
  announceChange()
}

export async function acceptConflict(mutation: NoteMutation, serverNote: Note, ownerId = owner()) {
  const database = await ready()
  const transaction = database.transaction('notes', 'readwrite')
  const store = transaction.objectStore('notes')
  const current = await request<NoteRecord | undefined>(store.get(ownedKey(ownerId, mutation.id)))
  if (current) {
    if (current.dirty && !current.purged && !serverNote.purged) {
      const id = newIdentifier()
      const suffix = ' (conflict copy)'
      store.add({ ...current, key: ownedKey(ownerId, id), id,
        title: `${current.title.slice(0, 500 - suffix.length)}${suffix}`, revision: 0, baseRevision: 0,
        updatedAt: new Date().toISOString(), deletedAt: null, purged: false, dirty: true,
        mutationId: newIdentifier(), syncedBody: '', syncedTitle: '' })
    }
    store.put(serverRecord(serverNote, ownerId))
  }
  await completed(transaction)
  announceChange()
}

export async function receiveNotes(notes: Note[], ownerId = owner()) {
  if (!notes.length) return
  const database = await ready()
  const transaction = database.transaction('notes', 'readwrite')
  const store = transaction.objectStore('notes')
  for (const note of notes) {
    const current = await request<NoteRecord | undefined>(store.get(ownedKey(ownerId, note.id)))
    if (!current || (!current.dirty && current.revision < note.revision)) store.put(serverRecord(note, ownerId))
  }
  await completed(transaction)
  announceChange()
}

export async function receiveNote(note: Note, ownerId = owner()) { await receiveNotes([note], ownerId) }

async function syncValue(key: string) {
  const database = await ready()
  const transaction = database.transaction('syncState', 'readonly')
  const state = await request<SyncRecord | undefined>(transaction.objectStore('syncState').get(key))
  await completed(transaction)
  return state?.value ?? 0
}

export function getCursor(ownerId = owner()) { return syncValue(`cursor:${ownerId}`) }

export async function setCursor(cursor: number, ownerId = owner()) {
  const database = await ready()
  const transaction = database.transaction('syncState', 'readwrite')
  transaction.objectStore('syncState').put({ key: `cursor:${ownerId}`, value: cursor } satisfies SyncRecord)
  await completed(transaction)
}

export function getGeneration(ownerId = owner()) { return syncValue(`generation:${ownerId}`) }

export async function resetLocalNotes(ownerId: string, generation: number) {
  const database = await ready()
  const transaction = database.transaction(['notes', 'attachments', 'syncState'], 'readwrite')
  const noteStore = transaction.objectStore('notes')
  const attachmentStore = transaction.objectStore('attachments')
  const noteKeys = await request<IDBValidKey[]>(noteStore.index('ownerId').getAllKeys(ownerId))
  const attachments = await request<AttachmentRecord[]>(attachmentStore.index('ownerId').getAll(ownerId))
  for (const key of noteKeys) noteStore.delete(key)
  for (const attachment of attachments) attachmentStore.delete(attachment.key)
  const syncStore = transaction.objectStore('syncState')
  syncStore.delete(`cursor:${ownerId}`)
  syncStore.put({ key: `generation:${ownerId}`, value: generation } satisfies SyncRecord)
  await completed(transaction)
  announceChange()
}
