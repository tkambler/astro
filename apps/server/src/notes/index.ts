import express, { type Express, type Response } from 'express'
import { pullNotes, pushNotes } from '@astronote/domain'
import { pullResult, pushRequest, pushResult } from '@astronote/schemas'
import { events } from '@astronote/events'
import { requireAccount } from '../account/index.js'
import { streamNotes } from './stream.js'

function fail(response: Response, error: unknown) {
  void events.emit('sync.failed', { message: error instanceof Error ? error.message : String(error) })
  return response.status(500).json({ error: 'Internal server error' })
}

/** Mounts the note change feed, batched push endpoint, and change stream. */
export function mountNoteRoutes(app: Express) {
  app.get('/api/notes/stream', async (request, response) => {
    try { await streamNotes(request, response) }
    catch (error) { if (!response.headersSent) fail(response, error); else response.end() }
  })
  app.get('/api/notes/changes', async (request, response) => {
    const cursor = Number(request.query.cursor ?? 0)
    if (!Number.isSafeInteger(cursor) || cursor < 0) return response.status(400).json({ error: 'Invalid cursor' })
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const result = pullResult.parse(await pullNotes(current.id, cursor))
      return response.json(result)
    } catch (error) { return fail(response, error) }
  })
  app.post('/api/notes/push', async (request, response, next) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      response.locals.accountId = current.id
      next()
    } catch (error) { fail(response, error) }
  }, express.json({ limit: '52mb' }), async (request, response) => {
    const parsed = pushRequest.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
    try {
      const accountId = response.locals.accountId as string
      const result = pushResult.parse(await pushNotes(accountId, parsed.data.mutations))
      await events.emit('sync.completed', { pushed: result.results.length, pulled: 0 })
      if (result.results.some(item => item.status === 'applied')) await events.emit('notes.changed', { accountId })
      return response.json(result)
    } catch (error) { return fail(response, error) }
  })
}
