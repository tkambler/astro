import { PGliteWorker } from '@electric-sql/pglite/worker'
import type { Note } from '@astronote/schemas'
import DbWorker from './worker.ts?worker'

export type LocalNote = Note & { dirty: boolean; mutationId: string | null; baseRevision: number;
  syncedBody: string; syncedTitle: string }
export type Row = { id: string; title: string; body: string; revision: number; updated_at: string;
  deleted_at: string | null; dirty: boolean; mutation_id: string | null; base_revision: number;
  tags: string[]; synced_body: string; synced_title: string }
export const accountKey = 'astronote-account-id'
export function activeAccountId() { return localStorage.getItem(accountKey) }
export function owner() { return activeAccountId() ?? 'guest' }
export const db = new PGliteWorker(new DbWorker({ name: 'astronote-notes' }))
const changes = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('astronote-notes-changed-v1')
export function onNotesChanged(listener: () => void) {
  if (!changes) return () => undefined
  const handler = () => listener()
  changes.addEventListener('message', handler)
  return () => changes.removeEventListener('message', handler)
}
export function announceChange() { changes?.postMessage('changed') }
let initialized: Promise<void> | undefined
export function ready() {
  initialized ??= db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id UUID PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      deleted_at TEXT, dirty BOOLEAN NOT NULL DEFAULT false,
      mutation_id UUID, base_revision INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT NOT NULL DEFAULT 'guest', tags TEXT[] NOT NULL DEFAULT '{}',
      synced_body TEXT NOT NULL DEFAULT '', synced_title TEXT NOT NULL DEFAULT ''
    );
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'guest';
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS synced_body TEXT NOT NULL DEFAULT '';
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS synced_title TEXT NOT NULL DEFAULT '';
    UPDATE notes SET synced_body=body,synced_title=title
      WHERE dirty=false AND synced_body='' AND synced_title='';
    CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `).then(() => undefined).catch(error => { initialized = undefined; throw error })
  return initialized
}
export function map(row: Row): LocalNote {
  return { id: row.id, title: row.title, body: row.body, tags: row.tags, revision: row.revision,
    updatedAt: row.updated_at, deletedAt: row.deleted_at, dirty: row.dirty,
    mutationId: row.mutation_id, baseRevision: row.base_revision,
    syncedBody: row.synced_body, syncedTitle: row.synced_title }
}
export const columns = 'id, title, body, tags, revision, updated_at, deleted_at, dirty, mutation_id, base_revision, synced_body, synced_title'
