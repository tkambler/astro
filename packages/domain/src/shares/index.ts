import { randomBytes } from 'node:crypto'
import { database } from '@astronote/db'
import type { NoteShare, PublicNote } from '@astronote/schemas'

type ShareRow = { id: string; note_id: string; title: string; created_at: Date }
const maximumSharesPerAccount = 100

export class ShareLimitError extends Error {}

function toShare(row: ShareRow): NoteShare {
  return { id: row.id, noteId: row.note_id, title: row.title, createdAt: row.created_at.toISOString() }
}

/** Creates an opaque public link for a note owned by the account. */
export async function createNoteShare(userId: string, noteId: string): Promise<NoteShare | null> {
  return database().transaction(async tx => {
    // Serialize share creation per account so the account cap cannot be crossed by concurrent requests for different notes.
    await tx('users').where({ id: userId }).forUpdate().first('id')
    const note = await tx('notes').where({ id: noteId, user_id: userId, purged: false }).whereNull('deleted_at').forUpdate().first('id', 'title')
    if (!note) return null
    const existing = await tx('note_shares').where({ note_id: note.id, user_id: userId }).first<ShareRow>()
    if (existing) return toShare({ ...existing, title: note.title })
    const [{ count = '0' } = {}] = await tx('note_shares').where({ user_id: userId }).count<{ count: string }[]>('* as count')
    if (Number(count) >= maximumSharesPerAccount) throw new ShareLimitError(`An account can have up to ${maximumSharesPerAccount} shared notes`)
    const row = { id: randomBytes(16).toString('base64url'), note_id: note.id, user_id: userId, created_at: new Date() }
    await tx('note_shares').insert(row)
    return toShare({ ...row, title: note.title })
  })
}

/** Lists every active public link owned by the account. */
export async function listNoteShares(userId: string): Promise<NoteShare[]> {
  const rows = await database()('note_shares as shares')
    .join('notes as notes', 'notes.id', 'shares.note_id')
    .where('shares.user_id', userId).andWhere('notes.purged', false).whereNull('notes.deleted_at')
    .orderBy('shares.created_at', 'desc')
    .select('shares.id', 'shares.note_id', 'shares.created_at', 'notes.title') as ShareRow[]
  return rows.map(toShare)
}

/** Revokes one public link, scoped to its owning account. */
export async function deleteNoteShare(userId: string, id: string): Promise<boolean> {
  return (await database()('note_shares').where({ id, user_id: userId }).del()) > 0
}

/** Resolves an active link without requiring an account. */
export async function getPublicNote(id: string): Promise<PublicNote | null> {
  const row = await database()('note_shares as shares')
    .join('notes as notes', 'notes.id', 'shares.note_id')
    .where('shares.id', id).andWhere('notes.purged', false).whereNull('notes.deleted_at')
    .first('notes.title', 'notes.body', 'notes.updated_at') as { title: string; body: string; updated_at: Date } | undefined
  return row ? { title: row.title, body: row.body, updatedAt: row.updated_at.toISOString() } : null
}
