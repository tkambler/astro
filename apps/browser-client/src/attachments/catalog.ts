import { attachment, attachmentList, type Attachment } from '@astronote/schemas'
import { activeAccountId, deleteLocalAttachment, listLocalAttachments, replaceLocalAttachments,
  saveLocalAttachment } from '../notes/local'

export async function localAttachments(noteId: string, ownerId = activeAccountId()) {
  return listLocalAttachments(noteId, ownerId)
}

export async function rememberAttachment(item: Attachment, ownerId = activeAccountId()) {
  await saveLocalAttachment(item, ownerId)
}

export async function forgetAttachment(id: string, ownerId = activeAccountId()) {
  await deleteLocalAttachment(id, ownerId)
}

export async function refreshAttachmentCatalog(noteId: string, ownerId = activeAccountId()) {
  if (!ownerId) return localAttachments(noteId, ownerId)
  const response = await fetch(`/api/notes/${noteId}/attachments`, { cache: 'no-store' })
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to manage attachments.' : 'Could not refresh attachments.')
  const items = attachmentList.parse(await response.json()).attachments
  await replaceLocalAttachments(noteId, items, ownerId)
  return items
}

export function upload(file: File, noteId: string, onProgress: (fraction: number) => void): Promise<Attachment> {
  return new Promise((accept, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `/api/notes/${noteId}/attachments?filename=${encodeURIComponent(file.name)}`)
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    request.setRequestHeader('x-astronote-request', '1')
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total) }
    request.onerror = () => reject(new Error('Upload interrupted. Reconnect and try again.'))
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        try { accept(attachment.parse(JSON.parse(request.responseText))) }
        catch { reject(new Error('The server returned an invalid attachment.')) }
      } else {
        try { reject(new Error((JSON.parse(request.responseText) as { error?: string }).error ?? 'Could not attach file.')) }
        catch { reject(new Error('Could not attach file.')) }
      }
    }
    request.send(file)
  })
}
