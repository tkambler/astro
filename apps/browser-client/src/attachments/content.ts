import type { Attachment } from '@astronote/schemas'
import { activeAccountId } from '../notes/local'

const cacheName = 'astronote-attachments-v1'
function cacheKey(id: string, ownerId = activeAccountId()) {
  return new Request(`${location.origin}/__astronote_attachment_cache__/${encodeURIComponent(ownerId ?? 'guest')}/${id}`)
}

export async function cached(id: string) {
  return !!await (await caches.open(cacheName)).match(cacheKey(id))
}

async function verifiedResponse(item: Attachment, response: Response) {
  const content = await response.arrayBuffer()
  if (content.byteLength !== item.byteSize) throw new Error('Downloaded file size did not match its record.')
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', content))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== item.sha256) throw new Error('Downloaded file could not be verified.')
  return new Response(content, { headers: { 'Content-Type': item.mediaType, 'Content-Length': String(item.byteSize) } })
}

export async function attachmentResponse(item: Attachment) {
  const store = await caches.open(cacheName)
  const key = cacheKey(item.id)
  const available = await store.match(key)
  if (available) return available
  if (!navigator.onLine) throw new Error('Connect to download this file.')
  const response = await fetch(`/api/attachments/${item.id}/content`, { cache: 'no-store' })
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to download this file.' : 'Could not download this file.')
  const verified = await verifiedResponse(item, response)
  await store.put(key, verified.clone())
  return verified
}

export async function openAttachment(item: Attachment) {
  const response = await attachmentResponse(item)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = item.filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function removeCachedAttachment(id: string) {
  await (await caches.open(cacheName)).delete(cacheKey(id))
}

export async function clearCachedAttachments(ownerId: string) {
  const store = await caches.open(cacheName)
  const prefix = `${location.origin}/__astronote_attachment_cache__/${encodeURIComponent(ownerId)}/`
  await Promise.all((await store.keys()).filter(key => key.url.startsWith(prefix)).map(key => store.delete(key)))
}
