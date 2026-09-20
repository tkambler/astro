import { events } from '@astronote/events'
import pino from 'pino'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const streams: Array<{ stream: NodeJS.WritableStream }> = [{ stream: process.stdout }]
if (process.env.NODE_ENV !== 'production') {
  const directory = join(process.cwd(), 'logs')
  mkdirSync(directory, { recursive: true })
  streams.push({ stream: createWriteStream(join(directory, 'server.log'), { flags: 'a' }) })
}
const logger = pino({}, pino.multistream(streams))
let subscribed = false
export function startLogging() {
  if (subscribed) return
  subscribed = true
  events.on('sync.completed', event => logger.info(event, 'sync completed'))
  events.on('sync.failed', event => logger.warn(event, 'sync failed'))
}
