import type { Express, Response } from 'express'
import { createNoteShare, deleteNoteShare, getPublicNote, listNoteShares, sharedAttachmentContent, ShareLimitError } from '@astronote/domain'
import { attachment, noteShare, publicNote, shareId } from '@astronote/schemas'
import { events } from '@astronote/events'
import { requireAccount } from '../account/index.js'
import { concurrencyLimit, consumeRateLimit, rateLimit } from '../security/index.js'

const publicShareConcurrency = concurrencyLimit(50)
const publicShareGlobalRate = rateLimit('public-share-global', 600, 60_000, () => 'all')
const publicShareIpRate = rateLimit('public-share-ip', 60, 60_000)
const publicImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

function fail(response: Response, error: unknown) {
  void events.emit('sync.failed', { message: error instanceof Error ? error.message : String(error) })
  return response.status(500).json({ error: 'Internal server error' })
}

/** Mounts authenticated share management and anonymous read-only note access. */
export function mountShareRoutes(app: Express) {
  app.get('/api/shared/:id', publicShareGlobalRate, publicShareIpRate, publicShareConcurrency, async (request, response) => {
    const id = shareId.safeParse(request.params.id)
    if (!id.success) return response.status(404).json({ error: 'Shared note not found' })
    try {
      const shared = await getPublicNote(id.data)
      if (!shared) return response.status(404).json({ error: 'Shared note not found' })
      response.set('Cache-Control', 'no-store')
      return response.json(publicNote.parse(shared))
    } catch (error) { return fail(response, error) }
  })
  app.get('/api/shared/:id/attachments/:attachmentId/content', publicShareGlobalRate, publicShareIpRate,
    publicShareConcurrency, async (request, response) => {
      const id = shareId.safeParse(request.params.id)
      const attachmentId = attachment.shape.id.safeParse(request.params.attachmentId)
      if (!id.success || !attachmentId.success) return response.status(404).json({ error: 'Shared image not found' })
      try {
        const content = await sharedAttachmentContent(id.data, attachmentId.data)
        if (!content || !publicImageTypes.has(content.attachment.mediaType))
          return response.status(404).json({ error: 'Shared image not found' })
        response.set({
          'Cache-Control': 'private, no-store',
          'Content-Type': content.attachment.mediaType,
          'Content-Length': String(content.attachment.byteSize),
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(content.attachment.filename)}`,
          'X-Content-Type-Options': 'nosniff',
        })
        content.stream.on('error', () => response.destroy())
        return content.stream.pipe(response)
      } catch (error) { return fail(response, error) }
    })
  app.get('/api/shares', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      response.set('Cache-Control', 'no-store')
      return response.json({ shares: noteShare.array().parse(await listNoteShares(current.id)) })
    } catch (error) { return fail(response, error) }
  })
  app.post('/api/shares', async (request, response) => {
    const noteId = typeof request.body?.noteId === 'string' ? request.body.noteId : ''
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const retryAfter = consumeRateLimit('create-share-account', current.id, 10, 60 * 60 * 1000)
      if (retryAfter) {
        response.set('Retry-After', String(retryAfter))
        return response.status(429).json({ error: 'Too many shared links created. Try again later.' })
      }
      const shared = await createNoteShare(current.id, noteId)
      if (!shared) return response.status(404).json({ error: 'Note not found' })
      return response.status(201).json(noteShare.parse(shared))
    } catch (error) {
      if (error instanceof ShareLimitError) return response.status(409).json({ error: error.message })
      return fail(response, error)
    }
  })
  app.delete('/api/shares/:id', async (request, response) => {
    const id = shareId.safeParse(request.params.id)
    if (!id.success) return response.status(404).json({ error: 'Shared link not found' })
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      if (!await deleteNoteShare(current.id, id.data)) return response.status(404).json({ error: 'Shared link not found' })
      return response.status(204).end()
    } catch (error) { return fail(response, error) }
  })
}
