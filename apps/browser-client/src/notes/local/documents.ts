import type { NoteSort } from '../../preferences'
import { announceChange, completed, ownedKey, owner, ready, request, type AttachmentRecord,
  type LocalNote, type NoteRecord } from './database'
import { newIdentifier } from './identifiers'

function publicNote({ key: _key, ownerId: _ownerId, ...note }: NoteRecord): LocalNote { return note }

async function ownerNotes(ownerId: string) {
  const database = await ready()
  const transaction = database.transaction('notes', 'readonly')
  const notes = await request<NoteRecord[]>(transaction.objectStore('notes').index('ownerId').getAll(ownerId))
  await completed(transaction)
  return notes
}

export async function listNotes(search = '', sort: NoteSort = 'modified', tag: string | null = null): Promise<LocalNote[]> {
  const term = search.toLocaleLowerCase()
  const notes = (await ownerNotes(owner())).filter(note => !note.deletedAt &&
    (!tag || note.tags.includes(tag)) && (!term || note.title.toLocaleLowerCase().includes(term) ||
      note.body.toLocaleLowerCase().includes(term) || note.tags.join(' ').toLocaleLowerCase().includes(term)))
  notes.sort((a, b) => {
    const rank = term ? Number(!a.title.toLocaleLowerCase().includes(term)) - Number(!b.title.toLocaleLowerCase().includes(term)) : 0
    if (rank) return rank
    const order = sort === 'title' ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) :
      a.updatedAt.localeCompare(b.updatedAt)
    return (sort === 'title' ? order : -order) || a.id.localeCompare(b.id)
  })
  return notes.map(publicNote)
}

export async function listTags(): Promise<string[]> {
  return [...new Set((await ownerNotes(owner())).filter(note => !note.deletedAt).flatMap(note => note.tags))].sort()
}

export async function listTrash(): Promise<LocalNote[]> {
  return (await ownerNotes(owner())).filter(note => note.deletedAt && !note.purged)
    .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!) || a.id.localeCompare(b.id)).map(publicNote)
}

export async function restoreNote(id: string, ownerId = owner()) {
  const database = await ready()
  const transaction = database.transaction('notes', 'readwrite')
  const store = transaction.objectStore('notes')
  const note = await request<NoteRecord | undefined>(store.get(ownedKey(ownerId, id)))
  const changed = !!note?.deletedAt && !note.purged
  if (note && changed) store.put({ ...note, deletedAt: null, updatedAt: new Date().toISOString(), dirty: true, mutationId: newIdentifier() })
  await completed(transaction)
  if (changed) announceChange()
  return changed
}

export async function emptyTrash(ownerId = owner()) {
  const database = await ready()
  const transaction = database.transaction(['notes', 'attachments'], 'readwrite')
  const noteStore = transaction.objectStore('notes')
  const attachmentStore = transaction.objectStore('attachments')
  const notes = await request<NoteRecord[]>(noteStore.index('ownerId').getAll(ownerId))
  const attachments = await request<AttachmentRecord[]>(attachmentStore.index('ownerId').getAll(ownerId))
  const purged = notes.filter(note => note.deletedAt && !note.purged)
  const noteIds = new Set(purged.map(note => note.id))
  const attachmentIds: string[] = []
  const now = new Date().toISOString()
  for (const note of purged) noteStore.put({ ...note, title: '', body: '', tags: [], pinned: false, purged: true,
    syncedTitle: '', syncedBody: '', updatedAt: now, dirty: true, mutationId: newIdentifier() })
  for (const attachment of attachments) if (noteIds.has(attachment.noteId)) {
    attachmentIds.push(attachment.id)
    attachmentStore.delete(attachment.key)
  }
  await completed(transaction)
  if (purged.length) announceChange()
  return { count: purged.length, attachmentIds }
}

export async function saveNote(id: string, title: string, body: string, deleted = false, ownerId = owner(), tags: string[] = [], collection = 'Notes') {
  const database = await ready()
  const transaction = database.transaction('notes', 'readwrite')
  const store = transaction.objectStore('notes')
  const key = ownedKey(ownerId, id)
  const current = await request<NoteRecord | undefined>(store.get(key))
  const changed = !current || current.title !== title || current.body !== body || current.collection !== collection ||
    current.tags.length !== tags.length || current.tags.some((tag, index) => tag !== tags[index]) || !!current.deletedAt !== deleted
  if (changed) {
    const now = new Date().toISOString()
    store.put(current ? { ...current, collection, title, body, tags, updatedAt: now, deletedAt: deleted ? now : null,
      dirty: true, mutationId: newIdentifier() } : {
      key, ownerId, id, collection, title, body, tags, pinned: false, purged: false, revision: 0,
      createdAt: now, updatedAt: now, deletedAt: deleted ? now : null, dirty: true, mutationId: newIdentifier(), baseRevision: 0,
      syncedBody: '', syncedTitle: '',
    } satisfies NoteRecord)
  }
  await completed(transaction)
  if (changed) announceChange()
  return changed
}

export async function setPinned(id: string, pinned: boolean, ownerId = owner()) {
  const database = await ready()
  const transaction = database.transaction('notes', 'readwrite')
  const store = transaction.objectStore('notes')
  const note = await request<NoteRecord | undefined>(store.get(ownedKey(ownerId, id)))
  const changed = !!note && !note.deletedAt && note.pinned !== pinned
  if (note && changed) store.put({ ...note, pinned, updatedAt: new Date().toISOString(), dirty: true, mutationId: newIdentifier() })
  await completed(transaction)
  if (changed) announceChange()
  return changed
}

export async function importLocalNotes(notes: { title: string; body: string; tags?: string[];
  pinned?: boolean; createdAt?: string; updatedAt?: string }[], onProgress?: (completed: number, total: number) => void) {
  const ownerId = owner()
  const database = await ready()
  const transaction = database.transaction('notes', 'readwrite')
  const store = transaction.objectStore('notes')
  for (const [index, note] of notes.entries()) {
    const id = newIdentifier()
    const now = new Date().toISOString()
    store.add({ key: ownedKey(ownerId, id), ownerId, id, collection: 'Notes', title: note.title, body: note.body, tags: note.tags ?? [],
      pinned: note.pinned ?? false, purged: false, revision: 0, createdAt: note.createdAt ?? note.updatedAt ?? now,
      updatedAt: note.updatedAt ?? note.createdAt ?? now, deletedAt: null, dirty: true, mutationId: newIdentifier(),
      baseRevision: 0, syncedBody: '', syncedTitle: '' } satisfies NoteRecord)
    onProgress?.(index + 1, notes.length)
  }
  await completed(transaction)
  announceChange()
}
