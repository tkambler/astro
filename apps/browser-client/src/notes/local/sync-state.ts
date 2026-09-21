import type { Note, NoteMutation } from '@astronote/schemas'
import { announceChange, columns, db, owner, ready, type Row } from './database'
import { newIdentifier } from './identifiers'

export async function pendingMutations(ownerId = owner()): Promise<NoteMutation[]> {
  await ready()
  const result = await db.query<Row>(`SELECT ${columns} FROM notes WHERE dirty = true AND owner_id=$1 ORDER BY updated_at ASC`, [ownerId])
  return result.rows.map(row => ({ mutationId: row.mutation_id!, id: row.id,
    baseRevision: row.base_revision, title: row.title, body: row.body, tags: row.tags, pinned: row.pinned, purged: row.purged,
    createdAt: row.created_at ?? row.updated_at, updatedAt: row.updated_at, deleted: !!row.deleted_at }))
}
export async function acceptPush(mutation: NoteMutation, serverNote: Note, ownerId = owner()) {
  await ready()
  // A newer local edit keeps its own mutation ID, while its base advances to the acknowledged revision.
  await db.query(`UPDATE notes SET revision=$1,base_revision=$1,
    synced_body=$6,synced_title=$7,
    dirty=CASE WHEN mutation_id=$2 THEN false ELSE dirty END,
    mutation_id=CASE WHEN mutation_id=$2 THEN NULL ELSE mutation_id END,
    updated_at=CASE WHEN mutation_id=$2 THEN $3 ELSE updated_at END
    WHERE id=$4 AND owner_id=$5`, [serverNote.revision, mutation.mutationId, serverNote.updatedAt, mutation.id, ownerId, mutation.body, mutation.title])
  announceChange()
}
export async function acceptConflict(mutation: NoteMutation, serverNote: Note, ownerId = owner()) {
  await ready()
  await db.transaction(async tx => {
    const current = await tx.query<Row>(`SELECT ${columns} FROM notes WHERE id=$1 AND owner_id=$2`, [mutation.id, ownerId])
    const local = current.rows[0]
    if (!local) return
    // The newest edit wins the copy, including edits made while the request was in flight.
    if (local.dirty && !local.purged && !serverNote.purged) {
      const suffix = ' (conflict copy)'
      await tx.query(`INSERT INTO notes (id,title,body,revision,created_at,updated_at,dirty,mutation_id,base_revision,owner_id,tags,pinned)
        VALUES ($1,$2,$3,0,$4,$5,true,$6,0,$7,$8::text[],$9)`,
      [newIdentifier(), `${local.title.slice(0, 500 - suffix.length)}${suffix}`, local.body,
        local.created_at ?? local.updated_at, new Date().toISOString(), newIdentifier(), ownerId, local.tags, local.pinned])
    }
    await tx.query(`UPDATE notes SET title=$1,body=$2,revision=$3,created_at=$4,updated_at=$5,deleted_at=$6,tags=$7::text[],pinned=$10,purged=$11,
      dirty=false,mutation_id=NULL,base_revision=$3,synced_body=$2,synced_title=$1
      WHERE id=$8 AND owner_id=$9`,
    [serverNote.title, serverNote.body, serverNote.revision, serverNote.createdAt, serverNote.updatedAt,
      serverNote.deletedAt, serverNote.tags, serverNote.id, ownerId, serverNote.pinned, serverNote.purged])
  })
  announceChange()
}
export async function receiveNote(note: Note, ownerId = owner()) {
  await ready()
  await db.query(`INSERT INTO notes (id,title,body,revision,created_at,updated_at,deleted_at,dirty,mutation_id,base_revision,owner_id,tags,pinned,purged,synced_body,synced_title)
    VALUES ($1,$2,$3,$4,$5,$6,$7,false,NULL,$4,$8,$9::text[],$10,$11,$3,$2)
    ON CONFLICT (id) DO UPDATE SET title=$2,body=$3,revision=$4,created_at=$5,updated_at=$6,deleted_at=$7,tags=$9::text[],pinned=$10,purged=$11,
      dirty=false,mutation_id=NULL,base_revision=$4,synced_body=$3,synced_title=$2
    WHERE notes.owner_id=$8 AND notes.dirty = false AND notes.revision < $4`,
    [note.id, note.title, note.body, note.revision, note.createdAt, note.updatedAt, note.deletedAt, ownerId, note.tags, note.pinned, note.purged])
  announceChange()
}
export async function getCursor(ownerId = owner()) {
  await ready()
  const result = await db.query<{ value: string }>(`SELECT value FROM sync_state WHERE key=$1`, [`cursor:${ownerId}`])
  return Number(result.rows[0]?.value ?? '0')
}
export async function setCursor(cursor: number, ownerId = owner()) {
  await ready()
  await db.query(`INSERT INTO sync_state(key,value) VALUES ($1,$2)
    ON CONFLICT(key) DO UPDATE SET value=$2`, [`cursor:${ownerId}`, String(cursor)])
}

export async function getGeneration(ownerId = owner()): Promise<number> {
  await ready()
  const result = await db.query<{ value: string }>(`SELECT value FROM sync_state WHERE key=$1`, [`generation:${ownerId}`])
  return Number(result.rows[0]?.value ?? '0')
}

/** Removes every local note for one workspace, including pending edits and tombstones. */
export async function resetLocalNotes(ownerId: string, generation: number) {
  await ready()
  await db.transaction(async tx => {
    await tx.query('DELETE FROM notes WHERE owner_id=$1', [ownerId])
    await tx.query('DELETE FROM sync_state WHERE key=$1', [`cursor:${ownerId}`])
    await tx.query(`INSERT INTO sync_state(key,value) VALUES ($1,$2)
      ON CONFLICT(key) DO UPDATE SET value=$2`, [`generation:${ownerId}`, String(generation)])
  })
  announceChange()
}
