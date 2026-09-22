import { database, publishNoteChange } from '@astronote/db'
import type { Collection, CollectionList } from '@astronote/schemas'

const key = (name: string) => name.toLowerCase()

/** Lists the account's explicit collection catalog, including empty collections. */
export async function listCollections(userId: string): Promise<CollectionList> {
  const rows = await database()('collections').where({ user_id: userId }).orderBy('name')
    .select<{ name: string }[]>('name')
  return { collections: rows }
}

/** Idempotently adds a collection and notifies other connected devices. */
export async function createCollection(userId: string, name: string): Promise<Collection> {
  return database().transaction(async tx => {
    const nameKey = key(name)
    const inserted = await tx('collections').insert({ user_id: userId, name, name_key: nameKey, created_at: new Date() })
      .onConflict(['user_id', 'name_key']).ignore().returning<{ name: string }[]>('name')
    if (inserted[0]) { await publishNoteChange(tx, userId); return inserted[0] }
    const existing = await tx('collections').where({ user_id: userId, name_key: nameKey }).first<{ name: string }>('name')
    if (!existing) throw new Error('Collection disappeared during creation')
    return existing
  })
}
