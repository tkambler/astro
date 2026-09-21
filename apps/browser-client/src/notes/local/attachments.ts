import type { Attachment } from '@astronote/schemas'
import { activeAccountId, db, ready } from './database'

type AttachmentRow = { id: string; note_id: string; filename: string; media_type: string; byte_size: number;
  sha256: string; created_at: string }

function mapAttachment(row: AttachmentRow): Attachment {
  return { id: row.id, noteId: row.note_id, filename: row.filename, mediaType: row.media_type,
    byteSize: row.byte_size, sha256: row.sha256, createdAt: row.created_at }
}

export async function listLocalAttachments(noteId: string, ownerId = activeAccountId()) {
  if (!ownerId) return []
  await ready()
  const result = await db.query<AttachmentRow>(`SELECT id,note_id,filename,media_type,byte_size,sha256,created_at
    FROM attachments WHERE owner_id=$1 AND note_id=$2 ORDER BY created_at,id`, [ownerId, noteId])
  return result.rows.map(mapAttachment)
}

export async function saveLocalAttachment(item: Attachment, ownerId = activeAccountId()) {
  if (!ownerId) return
  await ready()
  await db.query(`INSERT INTO attachments(id,note_id,owner_id,filename,media_type,byte_size,sha256,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(id) DO UPDATE SET note_id=$2,owner_id=$3,filename=$4,media_type=$5,byte_size=$6,sha256=$7,created_at=$8`,
  [item.id, item.noteId, ownerId, item.filename, item.mediaType, item.byteSize, item.sha256, item.createdAt])
}

export async function deleteLocalAttachment(id: string, ownerId = activeAccountId()) {
  if (!ownerId) return
  await ready()
  await db.query('DELETE FROM attachments WHERE id=$1 AND owner_id=$2', [id, ownerId])
}

export async function replaceLocalAttachments(noteId: string, items: Attachment[], ownerId = activeAccountId()) {
  if (!ownerId) return
  await ready()
  await db.transaction(async tx => {
    await tx.query('DELETE FROM attachments WHERE owner_id=$1 AND note_id=$2', [ownerId, noteId])
    for (const item of items) await tx.query(`INSERT INTO attachments(id,note_id,owner_id,filename,media_type,byte_size,sha256,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [item.id, item.noteId, ownerId, item.filename, item.mediaType, item.byteSize, item.sha256, item.createdAt])
  })
}
