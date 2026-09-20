import type { Request, Response } from 'express'
import { events } from '@astronote/events'
import { currentAccount, requireAccount } from '../account/index.js'

/** Sends an account-scoped hint; clients fetch note data through the REST change feed. */
export async function streamNotes(request: Request, response: Response) {
  const account = await requireAccount(request, response)
  if (!account) return
  response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive' })
  response.flushHeaders()
  response.write(': connected\n\n')
  const unsubscribe = events.on('notes.changed', event => {
    if (event.accountId === account.id) response.write('event: changed\ndata: {}\n\n')
  })
  let checking = false
  const heartbeat = setInterval(async () => {
    if (checking) return
    checking = true
    try {
      if ((await currentAccount(request))?.id !== account.id) response.end()
      else response.write(': heartbeat\n\n')
    } catch { response.end() }
    finally { checking = false }
  }, 25_000)
  response.on('close', () => { clearInterval(heartbeat); unsubscribe() })
}
