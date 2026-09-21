import express, { type NextFunction, type Request, type Response } from 'express'
import { createServer } from 'node:http'
import { startLogging } from '@astronote/log'
import { mountAccountRoutes, sessionCookieName } from './account/index.js'
import { mountApiDocs } from './docs/index.js'
import { mountFrontend } from './frontend/index.js'
import { mountNoteRoutes, mountNoteSockets } from './notes/index.js'
import { mountSystemRoutes } from './system/index.js'
import { mountShareRoutes } from './shares/index.js'

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
app.use('/api/system', express.json({ limit: '16kb' }))
app.use('/api/shares', express.json({ limit: '16kb' }))
mountAccountRoutes(app)
mountSystemRoutes(app)
mountShareRoutes(app)
app.get('/api/health', (_request, response) => response.json({ ok: true }))
mountApiDocs(app, { sessionCookie: sessionCookieName })
mountNoteRoutes(app)
app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }))
mountFrontend(app)
app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413)
    return response.status(413).json({ error: 'Request exceeds the size limit' })
  next(error)
})
const server = createServer(app)
await mountNoteSockets(server)
server.listen(Number(process.env.PORT ?? 3001))
