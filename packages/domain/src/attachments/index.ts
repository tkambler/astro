import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import { database, publishNoteChange } from '@astronote/db'
import type { Attachment } from '@astronote/schemas'

const maximumBytes = 25 * 1024 * 1024
const maximumPerNote = 20
function storageRoot() { return resolve(process.env.ATTACHMENT_STORAGE_PATH ?? '.data/attachments') }

type Row = { id: string; note_id: string; filename: string; media_type: string; byte_size: number;
  sha256: string; created_at: Date }

function toAttachment(row: Row): Attachment {
  return { id: row.id, noteId: row.note_id, filename: row.filename, mediaType: row.media_type,
    byteSize: row.byte_size, sha256: row.sha256, createdAt: row.created_at.toISOString() }
}

function contentPath(id: string) { return resolve(storageRoot(), id) }

export class AttachmentNotFoundError extends Error {}
export class AttachmentLimitError extends Error {}
export class AttachmentTooLargeError extends Error {}

export async function prepareAttachmentStorage() {
  const root = storageRoot()
  await mkdir(root, { recursive: true })
  const known = new Set((await database()('attachments').select<{ id: string }[]>('id')).map(row => row.id))
  for (const name of await readdir(root)) {
    const path = contentPath(name)
    if (name.endsWith('.tmp')) {
      const details = await stat(path).catch(() => null)
      if (details && Date.now() - details.mtimeMs > 60 * 60 * 1000) await rm(path, { force: true })
    } else if (/^[0-9a-f-]{36}$/.test(name) && !known.has(name)) await rm(path, { force: true })
  }
}

export async function listAttachments(userId: string, noteId: string): Promise<Attachment[] | null> {
  const note = await database()('notes').where({ id: noteId, user_id: userId, purged: false }).first('id')
  if (!note) return null
  const rows = await database()('attachments').where({ note_id: noteId, user_id: userId })
    .orderBy('created_at', 'asc') as Row[]
  return rows.map(toAttachment)
}

export async function createAttachment(userId: string, noteId: string, filename: string, mediaType: string,
  input: AsyncIterable<Uint8Array>): Promise<Attachment> {
  await mkdir(storageRoot(), { recursive: true })
  const id = randomUUID()
  const temporary = contentPath(`${id}.tmp`)
  const output = createWriteStream(temporary, { flags: 'wx' })
  const hash = createHash('sha256')
  let byteSize = 0
  try {
    for await (const chunk of input) {
      byteSize += chunk.byteLength
      if (byteSize > maximumBytes) throw new AttachmentTooLargeError('Files must be 25 MB or smaller')
      hash.update(chunk)
      if (!output.write(chunk)) await new Promise<void>((accept, reject) => {
        output.once('drain', accept); output.once('error', reject)
      })
    }
    output.end()
    await finished(output)
    const createdAt = new Date()
    const row = await database().transaction(async tx => {
      const note = await tx('notes').where({ id: noteId, user_id: userId, purged: false }).whereNull('deleted_at')
        .forUpdate().first('id')
      if (!note) throw new AttachmentNotFoundError('Note not found')
      const counts = await tx('attachments').where({ note_id: noteId, user_id: userId }).count<{ count: string }[]>('* as count')
      if (Number(counts[0]?.count ?? 0) >= maximumPerNote) throw new AttachmentLimitError('A note can have up to 20 attachments')
      const data = { id, note_id: noteId, user_id: userId, filename, media_type: mediaType, byte_size: byteSize,
        sha256: hash.digest('hex'), created_at: createdAt }
      await rename(temporary, contentPath(id))
      try { await tx('attachments').insert(data) }
      catch (error) { await rm(contentPath(id), { force: true }); throw error }
      await publishNoteChange(tx, userId)
      return data
    })
    return toAttachment(row)
  } catch (error) {
    output.destroy()
    await rm(temporary, { force: true })
    throw error
  }
}

export async function attachmentContent(userId: string, id: string) {
  const row = await database()('attachments').where({ id, user_id: userId }).first<Row>()
  if (!row) return null
  const handle = await open(contentPath(id), 'r').catch(() => null)
  if (!handle) return null
  await handle.close()
  return { attachment: toAttachment(row), stream: createReadStream(contentPath(id)) }
}

/** Resolves an attachment only when both it and its note are covered by the opaque public share. */
export async function sharedAttachmentContent(shareId: string, id: string) {
  const row = await database()('attachments as attachments')
    .join('note_shares as shares', function joinShare() {
      this.on('shares.note_id', '=', 'attachments.note_id').andOn('shares.user_id', '=', 'attachments.user_id')
    })
    .join('notes as notes', function joinNote() {
      this.on('notes.id', '=', 'attachments.note_id').andOn('notes.user_id', '=', 'attachments.user_id')
    })
    .where('shares.id', shareId).andWhere('attachments.id', id)
    .andWhere('notes.purged', false).whereNull('notes.deleted_at')
    .first('attachments.id', 'attachments.note_id', 'attachments.filename', 'attachments.media_type',
      'attachments.byte_size', 'attachments.sha256', 'attachments.created_at') as Row | undefined
  if (!row) return null
  const handle = await open(contentPath(id), 'r').catch(() => null)
  if (!handle) return null
  await handle.close()
  return { attachment: toAttachment(row), stream: createReadStream(contentPath(id)) }
}

export async function deleteAttachment(userId: string, id: string) {
  const removed = await database().transaction(async tx => {
    const count = await tx('attachments').where({ id, user_id: userId }).del()
    if (count) await publishNoteChange(tx, userId)
    return count
  })
  if (!removed) return false
  await rm(contentPath(id), { force: true })
  return true
}

/** Removes immutable content after its metadata was transactionally deleted elsewhere. */
export async function removeStoredAttachmentFiles(ids: string[]) {
  await Promise.all(ids.map(id => rm(contentPath(id), { force: true }).catch(() => undefined)))
}
