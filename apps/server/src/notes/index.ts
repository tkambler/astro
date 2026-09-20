import express, { type Express, type Response } from 'express'
import { NoteGenerationMismatchError, noteGeneration, pullNotes, pushNotes, resetNotes } from '@astronote/domain'
import { pullResult, pushRequest, pushResult } from '@astronote/schemas'
import { events } from '@astronote/events'
import { requireAccount } from '../account/index.js'
export { mountNoteSockets } from './socket.js'

function fail(response: Response, error: unknown) {
  void events.emit('sync.failed', { message: error instanceof Error ? error.message : String(error) })
  return response.status(500).json({ error: 'Internal server error' })
}

function requestedGeneration(value: string | undefined) {
  const generation = Number(value ?? '0')
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null
}

/** Mounts the note change feed and batched push endpoint. */
export function mountNoteRoutes(app: Express) {
  app.get('/api/notes/state', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      response.set('Cache-Control', 'no-store')
      return response.json({ generation: await noteGeneration(current.id) })
    } catch (error) { return fail(response, error) }
  })
  app.delete('/api/notes', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const generation = await resetNotes(current.id)
      response.set('Cache-Control', 'no-store')
      return response.json({ generation })
    } catch (error) { return fail(response, error) }
  })
  app.get('/api/notes/changes', async (request, response) => {
    const cursor = Number(request.query.cursor ?? 0)
    if (!Number.isSafeInteger(cursor) || cursor < 0) return response.status(400).json({ error: 'Invalid cursor' })
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const generation = requestedGeneration(request.get('x-astronote-generation'))
      if (generation === null) return response.status(400).json({ error: 'Invalid note generation' })
      if (generation !== await noteGeneration(current.id)) return response.status(409).json({ error: 'Notes were reset on another device' })
      const result = pullResult.parse(await pullNotes(current.id, cursor))
      return response.json(result)
    } catch (error) { return fail(response, error) }
  })
  app.post('/api/notes/push', async (request, response, next) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const generation = requestedGeneration(request.get('x-astronote-generation'))
      if (generation === null) return response.status(400).json({ error: 'Invalid note generation' })
      response.locals.accountId = current.id
      response.locals.generation = generation
      next()
    } catch (error) { fail(response, error) }
  }, express.json({ limit: '52mb' }), async (request, response) => {
    const parsed = pushRequest.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
    try {
      const accountId = response.locals.accountId as string
      const result = pushResult.parse(await pushNotes(accountId, parsed.data.mutations, response.locals.generation as number))
      await events.emit('sync.completed', { pushed: result.results.length, pulled: 0 })
      return response.json(result)
    } catch (error) {
      if (error instanceof NoteGenerationMismatchError) return response.status(409).json({ error: error.message })
      return fail(response, error)
    }
  })
}
