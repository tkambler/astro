import { PGlite } from '@electric-sql/pglite'
import type { LegacyAttachment, LegacyNote, LegacySnapshot } from './database'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (event: MessageEvent<string>) => {
  const legacy = new PGlite(`idb://${event.data}`)
  try {
    await legacy.waitReady
    await legacy.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id UUID PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT NOT NULL,
        deleted_at TEXT, dirty BOOLEAN NOT NULL DEFAULT false,
        mutation_id UUID, base_revision INTEGER NOT NULL DEFAULT 0,
        owner_id TEXT NOT NULL DEFAULT 'guest', tags TEXT[] NOT NULL DEFAULT '{}', pinned BOOLEAN NOT NULL DEFAULT false,
        purged BOOLEAN NOT NULL DEFAULT false, synced_body TEXT NOT NULL DEFAULT '', synced_title TEXT NOT NULL DEFAULT ''
      );
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'guest';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS purged BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS synced_body TEXT NOT NULL DEFAULT '';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS synced_title TEXT NOT NULL DEFAULT '';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS created_at TEXT;
      UPDATE notes SET created_at=updated_at WHERE created_at IS NULL;
      UPDATE notes SET synced_body=body,synced_title=title WHERE dirty=false AND synced_body='' AND synced_title='';
      CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments (
        id UUID PRIMARY KEY, note_id UUID NOT NULL, owner_id TEXT NOT NULL,
        filename TEXT NOT NULL, media_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `)
    const [notes, attachments, syncState] = await Promise.all([
      legacy.query<LegacyNote>('SELECT * FROM notes'),
      legacy.query<LegacyAttachment>('SELECT * FROM attachments'),
      legacy.query<{ key: string; value: string }>('SELECT key,value FROM sync_state'),
    ])
    self.postMessage({ notes: notes.rows, attachments: attachments.rows, syncState: syncState.rows } satisfies LegacySnapshot)
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  } finally {
    await legacy.close()
  }
}
