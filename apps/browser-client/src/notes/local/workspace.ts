import { accountKey, announceChange, completed, ownedKey, owner, ready, request, type NoteRecord } from './database'
import { newIdentifier } from './identifiers'
import { activateCollections } from '../../collections'

/** Moves guest notes into a newly connected account as fresh pending mutations. */
export async function activateAccount(accountId: string) {
  const database = await ready()
  if (owner() === accountId) return
  const transaction = database.transaction('notes', 'readwrite')
  const store = transaction.objectStore('notes')
  const guests = await request<NoteRecord[]>(store.index('ownerId').getAll('guest'))
  for (const guest of guests) if (!guest.deletedAt) {
    const id = newIdentifier()
    store.delete(guest.key)
    store.add({ ...guest, key: ownedKey(accountId, id), ownerId: accountId, id, revision: 0, baseRevision: 0,
      syncedBody: '', syncedTitle: '', dirty: true, mutationId: newIdentifier() })
  }
  await completed(transaction)
  activateCollections(accountId)
  localStorage.setItem(accountKey, accountId)
  announceChange()
}

export function deactivateAccount() {
  localStorage.removeItem(accountKey)
  announceChange()
}
