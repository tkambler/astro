import type { Attachment } from '@astronote/schemas'
import { attachmentResponse, cacheAttachmentContent } from './content'
import { localAttachments, rememberAttachment, upload } from './catalog'
import { embeddedImageId, embeddedImageSource } from './references'

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

/** Bridges stable Markdown attachment references to verified, temporary browser URLs. */
export function embeddedImages(noteId: string) {
  const objectUrls = new Set<string>()
  return {
    async upload(file: File) {
      if (!imageTypes.has(file.type)) throw new Error('Choose a PNG, JPEG, GIF, WebP, or AVIF image.')
      const created = await upload(file, noteId, () => undefined)
      await Promise.all([rememberAttachment(created), cacheAttachmentContent(created, file)])
      window.dispatchEvent(new CustomEvent('astronote-attachment-created', { detail: created }))
      return embeddedImageSource(created.id)
    },
    async preview(source: string) {
      const id = embeddedImageId(source)
      if (!id) throw new Error('Only images attached to this note can be displayed.')
      const item = (await localAttachments(noteId)).find(attachment => attachment.id === id)
      if (!item || !imageTypes.has(item.mediaType)) throw new Error('Attached image is unavailable.')
      const response = await attachmentResponse(item)
      const url = URL.createObjectURL(await response.blob())
      objectUrls.add(url)
      return url
    },
    dispose() {
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.clear()
    },
  }
}

export function attachmentIsEmbeddedImage(item: Attachment) { return imageTypes.has(item.mediaType) }
