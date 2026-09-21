import type { Express, Response } from 'express'
import { attachment as attachmentSchema, attachmentList } from '@astronote/schemas'
import { attachmentContent, createAttachment, deleteAttachment, listAttachments,
  AttachmentLimitError, AttachmentNotFoundError, AttachmentTooLargeError } from '@astronote/domain'
import { events } from '@astronote/events'
import { requireAccount } from '../account/index.js'

function filename(value: unknown) {
  if (typeof value !== 'string') return null
  const decoded = value.trim()
  if (!decoded || decoded.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(decoded)) return null
  return decoded
}

function mediaType(value: string | undefined) {
  const type = (value ?? 'application/octet-stream').split(';', 1)[0]!.trim().toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) && type.length <= 255
    ? type : 'application/octet-stream'
}

function identifier(value: string | undefined) {
  return attachmentSchema.shape.id.safeParse(value)
}

function failure(response: Response, error: unknown) {
  if (error instanceof AttachmentNotFoundError) return response.status(404).json({ error: error.message })
  if (error instanceof AttachmentLimitError) return response.status(409).json({ error: error.message })
  if (error instanceof AttachmentTooLargeError) return response.status(413).json({ error: error.message })
  return response.status(500).json({ error: 'Could not store attachment' })
}

export function mountAttachmentRoutes(app: Express) {
  app.get('/api/notes/:noteId/attachments', async (request, response) => {
    const noteId = identifier(request.params.noteId)
    if (!noteId.success) return response.status(400).json({ error: 'Invalid note ID' })
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const attachments = await listAttachments(current.id, noteId.data)
      if (!attachments) return response.status(404).json({ error: 'Note not found' })
      response.set('Cache-Control', 'no-store')
      return response.json(attachmentList.parse({ attachments }))
    } catch (error) {
      await events.emit('attachment.failed', { message: error instanceof Error ? error.message : String(error) })
      return response.status(500).json({ error: 'Could not load attachments' })
    }
  })

  app.post('/api/notes/:noteId/attachments', async (request, response) => {
    const noteId = identifier(request.params.noteId)
    if (!noteId.success) return response.status(400).json({ error: 'Invalid note ID' })
    const selectedName = filename(request.query.filename)
    if (!selectedName) return response.status(400).json({ error: 'Invalid filename' })
    let accountId: string | undefined
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      accountId = current.id
      const created = attachmentSchema.parse(await createAttachment(current.id, noteId.data, selectedName,
        mediaType(request.get('content-type')), request))
      await events.emit('attachment.created', { accountId: current.id, noteId: created.noteId,
        attachmentId: created.id, byteSize: created.byteSize })
      return response.status(201).json(created)
    } catch (error) {
      await events.emit('attachment.failed', { accountId, message: error instanceof Error ? error.message : String(error) })
      return failure(response, error)
    }
  })

  app.get('/api/attachments/:id/content', async (request, response) => {
    const id = identifier(request.params.id)
    if (!id.success) return response.status(400).json({ error: 'Invalid attachment ID' })
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const content = await attachmentContent(current.id, id.data)
      if (!content) return response.status(404).json({ error: 'Attachment not found' })
      response.set({
        'Cache-Control': 'private, no-store',
        'Content-Type': content.attachment.mediaType,
        'Content-Length': String(content.attachment.byteSize),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(content.attachment.filename)}`,
        'X-Content-Type-Options': 'nosniff',
      })
      content.stream.on('error', () => response.destroy())
      return content.stream.pipe(response)
    } catch { return response.status(500).json({ error: 'Could not download attachment' }) }
  })

  app.delete('/api/attachments/:id', async (request, response) => {
    const parsedId = identifier(request.params.id)
    if (!parsedId.success) return response.status(400).json({ error: 'Invalid attachment ID' })
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const id = parsedId.data
      if (!await deleteAttachment(current.id, id)) return response.status(404).json({ error: 'Attachment not found' })
      await events.emit('attachment.deleted', { accountId: current.id, attachmentId: id })
      return response.status(204).end()
    } catch (error) {
      await events.emit('attachment.failed', { message: error instanceof Error ? error.message : String(error) })
      return response.status(500).json({ error: 'Could not delete attachment' })
    }
  })
}
