import { Client } from 'pg'
import type { Knex } from 'knex'

const channel = 'astronote_notes_changed'

/** Publish inside the note transaction; PostgreSQL delivers it only after commit. */
export async function publishNoteChange(transaction: Knex.Transaction, accountId: string) {
  await transaction.raw('SELECT pg_notify(?, ?)', [channel, accountId])
}

/** Listen on a dedicated PostgreSQL connection so every API instance sees committed note changes. */
export async function watchNoteChanges(onChange: (accountId: string) => void,
  onAvailabilityChange: (available: boolean) => void) {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  let client: Client | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let delay = 1_000

  const connect = async (initial = false) => {
    const next = new Client({ connectionString })
    const disconnected = () => {
      if (client !== next || stopped) return
      client = null
      onAvailabilityChange(false)
      void next.end().catch(() => undefined)
      retry = setTimeout(() => { void connect() }, delay)
      delay = Math.min(delay * 2, 30_000)
    }
    next.on('error', disconnected)
    next.on('end', disconnected)
    next.on('notification', message => {
      if (message.channel === channel && message.payload) onChange(message.payload)
    })
    try {
      await next.connect()
      await next.query(`LISTEN ${channel}`)
      if (stopped) { await next.end(); return }
      client = next
      delay = 1_000
      onAvailabilityChange(true)
    } catch (error) {
      await next.end().catch(() => undefined)
      if (initial) throw error
      retry = setTimeout(() => { void connect() }, delay)
      delay = Math.min(delay * 2, 30_000)
    }
  }
  await connect(true)
  return () => {
    stopped = true
    clearTimeout(retry)
    void client?.end().catch(() => undefined)
  }
}
