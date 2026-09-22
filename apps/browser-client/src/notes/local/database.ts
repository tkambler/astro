import type { Attachment, Note } from '@astronote/schemas'

export type LocalNote = Note & { dirty: boolean; mutationId: string | null; baseRevision: number;
  syncedBody: string; syncedTitle: string }
export type NoteRecord = LocalNote & { key: string; ownerId: string }
export type AttachmentRecord = Attachment & { key: string; ownerId: string }
export type SyncRecord = { key: string; value: number }
export type MetaRecord = { key: string; value: string }

export const accountKey = 'astronote-account-id'
export function activeAccountId() { return localStorage.getItem(accountKey) }
export function owner() { return activeAccountId() ?? 'guest' }
export function ownedKey(ownerId: string, id: string) { return `${ownerId}\0${id}` }

const databaseName = 'astronote-local-v2'
const legacyDatabaseName = 'astronote-notes-v1'
const migrationKey = 'pglite-v1-migrated'

const changes = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('astronote-notes-changed-v1')
export function onNotesChanged(listener: () => void) {
  if (!changes) return () => undefined
  const handler = () => listener()
  changes.addEventListener('message', handler)
  return () => changes.removeEventListener('message', handler)
}
export function announceChange() { changes?.postMessage('changed') }

export function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error ?? new Error('IndexedDB request failed'))
  })
}

export function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 1)
    opening.onupgradeneeded = () => {
      const database = opening.result
      const notes = database.createObjectStore('notes', { keyPath: 'key' })
      notes.createIndex('ownerId', 'ownerId')
      const attachments = database.createObjectStore('attachments', { keyPath: 'key' })
      attachments.createIndex('ownerId', 'ownerId')
      attachments.createIndex('ownerNote', ['ownerId', 'noteId'])
      database.createObjectStore('syncState', { keyPath: 'key' })
      database.createObjectStore('meta', { keyPath: 'key' })
    }
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error ?? new Error('Could not open local note storage'))
    opening.onblocked = () => reject(new Error('Local note storage upgrade is blocked by another app window'))
  })
}

async function legacyDatabaseExists() {
  return new Promise<boolean>((resolve, reject) => {
    let created = false
    const opening = indexedDB.open(legacyDatabaseName)
    opening.onupgradeneeded = event => {
      created = (event as IDBVersionChangeEvent).oldVersion === 0
      if (created) opening.transaction?.abort()
    }
    opening.onsuccess = () => { opening.result.close(); resolve(true) }
    opening.onerror = () => {
      if (created && opening.error?.name === 'AbortError') resolve(false)
      else reject(opening.error ?? new Error('Could not inspect legacy note storage'))
    }
  })
}

function deleteLegacyDatabase() {
  return new Promise<void>(resolve => {
    const deletion = indexedDB.deleteDatabase(legacyDatabaseName)
    deletion.onsuccess = () => resolve()
    deletion.onerror = () => resolve()
    // An older app window can keep the database open. Do not delay startup; its next launch will retry cleanup.
    deletion.onblocked = () => resolve()
  })
}

export type LegacyNote = { id: string; title: string; body: string; pinned: boolean; purged: boolean; revision: number;
  created_at: string | null; updated_at: string; deleted_at: string | null; dirty: boolean;
  mutation_id: string | null; base_revision: number; owner_id: string; tags: string[];
  synced_body: string; synced_title: string }
export type LegacyAttachment = { id: string; note_id: string; owner_id: string; filename: string; media_type: string;
  byte_size: number; sha256: string; created_at: string }
export type LegacySnapshot = { notes: LegacyNote[]; attachments: LegacyAttachment[];
  syncState: { key: string; value: string }[] }

async function readLegacyDatabase(): Promise<LegacySnapshot> {
  const { default: LegacyMigrationWorker } = await import('./legacy-migration.ts?worker')
  const worker = new LegacyMigrationWorker({ name: 'astronote-pglite-migration' })
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<LegacySnapshot | { error: string }>) => {
      worker.terminate()
      if ('error' in event.data) reject(new Error(event.data.error))
      else resolve(event.data)
    }
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Could not read legacy note storage')) }
    worker.postMessage(legacyDatabaseName)
  })
}

async function migrateLegacyDatabase(database: IDBDatabase) {
  const check = database.transaction('meta', 'readonly')
  const migrated = await request<MetaRecord | undefined>(check.objectStore('meta').get(migrationKey))
  await completed(check)
  if (migrated) { await deleteLegacyDatabase(); return }

  if (!await legacyDatabaseExists()) {
    const transaction = database.transaction('meta', 'readwrite')
    transaction.objectStore('meta').put({ key: migrationKey, value: new Date().toISOString() } satisfies MetaRecord)
    await completed(transaction)
    return
  }

  const snapshot = await readLegacyDatabase()
  {
    const transaction = database.transaction(['notes', 'attachments', 'syncState', 'meta'], 'readwrite')
    const noteStore = transaction.objectStore('notes')
    for (const row of snapshot.notes) noteStore.put({
      key: ownedKey(row.owner_id, row.id), ownerId: row.owner_id, id: row.id, title: row.title, body: row.body,
      tags: row.tags, pinned: row.pinned, purged: row.purged, revision: row.revision,
      createdAt: row.created_at ?? row.updated_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
      dirty: row.dirty, mutationId: row.mutation_id, baseRevision: row.base_revision,
      syncedBody: row.synced_body, syncedTitle: row.synced_title,
    } satisfies NoteRecord)
    const attachmentStore = transaction.objectStore('attachments')
    for (const row of snapshot.attachments) attachmentStore.put({
      key: ownedKey(row.owner_id, row.id), ownerId: row.owner_id, id: row.id, noteId: row.note_id,
      filename: row.filename, mediaType: row.media_type, byteSize: row.byte_size,
      sha256: row.sha256, createdAt: row.created_at,
    } satisfies AttachmentRecord)
    const syncStore = transaction.objectStore('syncState')
    for (const row of snapshot.syncState) syncStore.put({ key: row.key, value: Number(row.value) } satisfies SyncRecord)
    const [noteCount, attachmentCount, syncCount] = await Promise.all([
      request(noteStore.count()), request(attachmentStore.count()), request(syncStore.count()),
    ])
    if (noteCount !== snapshot.notes.length || attachmentCount !== snapshot.attachments.length || syncCount !== snapshot.syncState.length) {
      transaction.abort()
      throw new Error('Could not verify the local note migration')
    }
    transaction.objectStore('meta').put({ key: migrationKey, value: new Date().toISOString() } satisfies MetaRecord)
    await completed(transaction)
    await deleteLegacyDatabase()
  }
}

let initialized: Promise<IDBDatabase> | undefined
export function ready() {
  initialized ??= openDatabase().then(async database => {
    try {
      if (navigator.locks) await navigator.locks.request('astronote-storage-migration', () => migrateLegacyDatabase(database))
      else await migrateLegacyDatabase(database)
      return database
    }
    catch (error) { database.close(); initialized = undefined; throw error }
  })
  return initialized
}
