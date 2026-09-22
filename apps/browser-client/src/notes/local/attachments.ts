import type { Attachment } from '@astronote/schemas'
import { activeAccountId, completed, ownedKey, ready, request, type AttachmentRecord } from './database'

function publicAttachment({ key: _key, ownerId: _ownerId, ...attachment }: AttachmentRecord): Attachment { return attachment }

export async function listLocalAttachments(noteId: string, ownerId = activeAccountId()) {
  if (!ownerId) return []
  const database = await ready()
  const transaction = database.transaction('attachments', 'readonly')
  const range = IDBKeyRange.only([ownerId, noteId])
  const attachments = await request<AttachmentRecord[]>(transaction.objectStore('attachments').index('ownerNote').getAll(range))
  await completed(transaction)
  return attachments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(publicAttachment)
}

export async function saveLocalAttachment(item: Attachment, ownerId = activeAccountId()) {
  if (!ownerId) return
  const database = await ready()
  const transaction = database.transaction('attachments', 'readwrite')
  transaction.objectStore('attachments').put({ ...item, key: ownedKey(ownerId, item.id), ownerId } satisfies AttachmentRecord)
  await completed(transaction)
}

export async function deleteLocalAttachment(id: string, ownerId = activeAccountId()) {
  if (!ownerId) return
  const database = await ready()
  const transaction = database.transaction('attachments', 'readwrite')
  transaction.objectStore('attachments').delete(ownedKey(ownerId, id))
  await completed(transaction)
}

export async function replaceLocalAttachments(noteId: string, items: Attachment[], ownerId = activeAccountId()) {
  if (!ownerId) return
  const database = await ready()
  const transaction = database.transaction('attachments', 'readwrite')
  const store = transaction.objectStore('attachments')
  const existing = await request<AttachmentRecord[]>(store.index('ownerNote').getAll(IDBKeyRange.only([ownerId, noteId])))
  for (const attachment of existing) store.delete(attachment.key)
  for (const item of items) store.put({ ...item, key: ownedKey(ownerId, item.id), ownerId } satisfies AttachmentRecord)
  await completed(transaction)
}
