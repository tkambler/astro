import type { NoteSort } from '../../preferences'
import { announceChange, columns, db, map, owner, ready, type LocalNote, type Row } from './database'

export async function listNotes(search = '', sort: NoteSort = 'modified', tag: string | null = null): Promise<LocalNote[]> {
  const ownerId = owner()
  await ready()
  const pattern = `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  const ranking = search ? `CASE WHEN title ILIKE $1 ESCAPE '\\' THEN 0 ELSE 1 END,` : ''
  const order = sort === 'title' ? 'lower(title) ASC, updated_at DESC, id ASC' : 'updated_at DESC, id ASC'
  const result = await db.query<Row>(`SELECT ${columns} FROM notes WHERE deleted_at IS NULL
    AND owner_id = $2
    AND (title ILIKE $1 ESCAPE '\\' OR body ILIKE $1 ESCAPE '\\' OR array_to_string(tags, ' ') ILIKE $1 ESCAPE '\\')
    AND ($3::text IS NULL OR $3 = ANY(tags))
    ORDER BY ${ranking} ${order}`, [pattern, ownerId, tag])
  return result.rows.map(map)
}
export async function listTags(): Promise<string[]> {
  const ownerId = owner()
  await ready()
  const result = await db.query<{ tag: string }>(`SELECT DISTINCT tag FROM notes, unnest(tags) AS tag
    WHERE deleted_at IS NULL AND owner_id=$1 ORDER BY tag`, [ownerId])
  return result.rows.map(row => row.tag)
}
export async function saveNote(id: string, title: string, body: string, deleted = false, ownerId = owner(), tags: string[] = []) {
  await ready()
  const now = new Date().toISOString()
  const result = await db.query(`INSERT INTO notes (id,title,body,revision,created_at,updated_at,deleted_at,dirty,mutation_id,base_revision,owner_id,tags)
    VALUES ($1,$2,$3,0,$4,$4,$5,true,$6,0,$7,$8::text[])
    ON CONFLICT (id) DO UPDATE SET title=$2,body=$3,updated_at=$4,deleted_at=$5,
      dirty=true,mutation_id=$6,tags=$8::text[]
    WHERE notes.owner_id=$7 AND (notes.title IS DISTINCT FROM $2 OR notes.body IS DISTINCT FROM $3
      OR notes.tags IS DISTINCT FROM $8::text[]
      OR (notes.deleted_at IS NULL) IS DISTINCT FROM ($5::text IS NULL))`,
    [id, title, body, now, deleted ? now : null, crypto.randomUUID(), ownerId, tags])
  if (result.rowCount) announceChange()
  return result.rowCount !== 0
}
/** Adds a validated backup in one local transaction, bound to the active workspace. */
export async function importLocalNotes(notes: { title: string; body: string; tags?: string[];
  createdAt?: string; updatedAt?: string }[], onProgress?: (completed: number, total: number) => void) {
  const ownerId = owner()
  await ready()
  await db.transaction(async tx => {
    for (const [index, note] of notes.entries()) {
      const now = new Date().toISOString()
      await tx.query(`INSERT INTO notes (id,title,body,revision,created_at,updated_at,dirty,mutation_id,base_revision,owner_id,tags)
        VALUES ($1,$2,$3,0,$4,$5,true,$6,0,$7,$8::text[])`,
      [crypto.randomUUID(), note.title, note.body, note.createdAt ?? note.updatedAt ?? now,
        note.updatedAt ?? note.createdAt ?? now, crypto.randomUUID(), ownerId, note.tags ?? []])
      onProgress?.(index + 1, notes.length)
    }
  })
  announceChange()
}
