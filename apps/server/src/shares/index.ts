import type { Express, Response } from 'express'
import { createNoteShare, deleteNoteShare, getPublicNote, listNoteShares } from '@astronote/domain'
import { noteShare, publicNote, shareId } from '@astronote/schemas'
import { events } from '@astronote/events'
import { requireAccount } from '../account/index.js'

function fail(response: Response, error: unknown) {
  void events.emit('sync.failed', { message: error instanceof Error ? error.message : String(error) })
  return response.status(500).json({ error: 'Internal server error' })
}

/** Mounts authenticated share management and anonymous read-only note access. */
export function mountShareRoutes(app: Express) {
  app.get('/api/shared/:id', async (request, response) => {
    const id = shareId.safeParse(request.params.id)
    if (!id.success) return response.status(404).json({ error: 'Shared note not found' })
    try {
      const shared = await getPublicNote(id.data)
      if (!shared) return response.status(404).json({ error: 'Shared note not found' })
      response.set('Cache-Control', 'no-store')
      return response.json(publicNote.parse(shared))
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
      const shared = await createNoteShare(current.id, noteId)
      if (!shared) return response.status(404).json({ error: 'Note not found' })
      return response.status(201).json(noteShare.parse(shared))
    } catch (error) { return fail(response, error) }
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
