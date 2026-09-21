import { database, publishNoteChange, watchNoteChanges } from '@astronote/db'
export { watchNoteChanges }
import type { Note, NoteMutation, PushResult, PullResult } from '@astronote/schemas'

type Row = { id: string; title: string; body: string; tags: string[]; pinned: boolean; purged: boolean; revision: number;
  created_at: Date; updated_at: Date; deleted_at: Date | null }
function toNote(row: Row): Note {
  return { id: row.id, title: row.title, body: row.body, tags: row.tags, pinned: row.pinned, purged: row.purged, revision: row.revision,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null }
}

export class NoteGenerationMismatchError extends Error {
  constructor() { super('Notes were reset on another device') }
}

/** The account generation prevents an old offline device from restoring reset notes. */
export async function noteGeneration(userId: string): Promise<number> {
  const user = await database()('users').where({ id: userId }).first('note_generation')
  if (!user) throw new Error('Account not found')
  return user.note_generation
}

/** Permanently removes an account's notes and history, then invalidates older clients. */
export async function resetNotes(userId: string): Promise<number> {
  return database().transaction(async tx => {
    await tx.raw('SELECT pg_advisory_xact_lock(918273645)')
    const [user] = await tx('users').where({ id: userId }).increment('note_generation', 1).returning('note_generation')
    if (!user) throw new Error('Account not found')
    await tx('note_mutations').where({ user_id: userId }).del()
    await tx('note_changes').where({ user_id: userId }).del()
    await tx('notes').where({ user_id: userId }).del()
    await publishNoteChange(tx, userId)
    return user.note_generation as number
  })
}

/** Applies each mutation once, using a server revision as the conflict boundary. */
export async function pushNotes(userId: string, mutations: NoteMutation[], generation = 0): Promise<PushResult> {
  return database().transaction(async tx => {
    // Serialize change sequence allocation so pull cursors cannot skip late commits.
    await tx.raw('SELECT pg_advisory_xact_lock(918273645)')
    const user = await tx('users').where({ id: userId }).first('note_generation')
    if (!user || user.note_generation !== generation) throw new NoteGenerationMismatchError()
    const results: PushResult['results'] = []
    let changed = false
    for (const mutation of mutations) {
      const previous = await tx('note_mutations').where({ id: mutation.mutationId, user_id: userId }).first()
      const current = await tx('notes').where({ id: mutation.id, user_id: userId }).first<Row>()
      if (previous) {
        if (!current) throw new Error('Applied mutation has no note')
        if (current.revision > mutation.baseRevision + 1) {
          results.push({ status: 'conflict', mutationId: mutation.mutationId, serverNote: toNote(current) })
        } else {
          results.push({ status: 'applied', mutationId: mutation.mutationId, note: toNote(current) })
        }
        continue
      }
      if ((current?.revision ?? 0) !== mutation.baseRevision) {
        if (!current) throw new Error('Conflict without server note')
        results.push({ status: 'conflict', mutationId: mutation.mutationId, serverNote: toNote(current) })
        continue
      }
      if (current?.purged && !mutation.purged) {
        results.push({ status: 'conflict', mutationId: mutation.mutationId, serverNote: toNote(current) })
        continue
      }
      const now = new Date()
      const revision = mutation.baseRevision + 1
      const purged = mutation.purged ?? false
      const data = { id: mutation.id, title: purged ? '' : mutation.title, body: purged ? '' : mutation.body,
        tags: purged ? [] : mutation.tags, pinned: purged ? false : mutation.pinned ?? current?.pinned ?? false, purged,
        revision, created_at: current?.created_at ?? (mutation.createdAt ? new Date(mutation.createdAt) : now),
        updated_at: current ? now : (mutation.updatedAt ? new Date(mutation.updatedAt) : now),
        deleted_at: mutation.deleted || purged ? now : null }
      if (current) await tx('notes').where({ id: mutation.id, user_id: userId }).update(data)
      else await tx('notes').insert({ ...data, user_id: userId })
      await tx('note_changes').insert({ note_id: mutation.id, user_id: userId, revision })
      await tx('note_mutations').insert({ id: mutation.mutationId, note_id: mutation.id, user_id: userId })
      changed = true
      results.push({ status: 'applied', mutationId: mutation.mutationId, note: toNote(data) })
    }
    if (changed) await publishNoteChange(tx, userId)
    return { results }
  })
}

/** Returns a bounded change page, including tombstones, after the given cursor. */
export async function pullNotes(userId: string, cursor: number, limit = 100): Promise<PullResult> {
  const db = database()
  const rows = await db('note_changes as changes')
    .join('notes as notes', 'notes.id', 'changes.note_id')
    .where('changes.sequence', '>', cursor)
    .andWhere('changes.user_id', userId)
    .orderBy('changes.sequence', 'asc')
    .limit(limit + 1)
    .select('changes.sequence', 'notes.id', 'notes.title', 'notes.body', 'notes.tags', 'notes.pinned', 'notes.purged',
      'notes.revision', 'notes.created_at', 'notes.updated_at', 'notes.deleted_at') as (Row & { sequence: string })[]
  const page = rows.slice(0, limit)
  return { changes: page.map(toNote), cursor: page.length ? Number(page[page.length - 1]!.sequence) : cursor,
    hasMore: rows.length > limit }
}
