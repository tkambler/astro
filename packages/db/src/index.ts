import knex from 'knex'
export { publishNoteChange, watchNoteChanges } from './notifications.js'

let instance: ReturnType<typeof knex> | undefined
export function database() {
  if (!instance) {
    const connection = process.env.DATABASE_URL
    if (!connection) throw new Error('DATABASE_URL is required')
    instance = knex({ client: 'pg', connection, pool: { min: 0, max: 10 } })
  }
  return instance
}
