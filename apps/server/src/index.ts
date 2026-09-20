import express, { type NextFunction, type Request, type Response } from 'express'
import { pullNotes, pushNotes } from '@astronote/domain'
import { pullResult, pushRequest, pushResult } from '@astronote/schemas'
import { events } from '@astronote/events'
import { startLogging } from '@astronote/log'
import { mountAccountRoutes, requireAccount } from './account/index.js'
import { mountFrontend } from './frontend/index.js'

startLogging()
const app = express()
const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0)
if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) throw new Error('TRUST_PROXY_HOPS must be a nonnegative integer')
app.set('trust proxy', trustedProxyHops)
app.use('/api', (request, response, next) => {
  if (request.method !== 'GET' && request.get('x-astronote-request') !== '1')
    return response.status(403).json({ error: 'Missing request header' })
  next()
})
app.use('/api/account', express.json({ limit: '16kb' }))
mountAccountRoutes(app)
app.get('/api/health', (_request, response) => response.json({ ok: true }))
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
    const result = pushResult.parse(await pushNotes(response.locals.accountId as string, parsed.data.mutations))
    await events.emit('sync.completed', { pushed: result.results.length, pulled: 0 })
    return response.json(result)
  } catch (error) { return fail(response, error) }
})
app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }))
mountFrontend(app)
app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413)
    return response.status(413).json({ error: 'Request exceeds the size limit' })
  next(error)
})
function fail(response: express.Response, error: unknown) {
  void events.emit('sync.failed', { message: error instanceof Error ? error.message : String(error) })
  return response.status(500).json({ error: 'Internal server error' })
}
app.listen(Number(process.env.PORT ?? 3001))
