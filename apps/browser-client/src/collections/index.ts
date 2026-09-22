import { activeAccountId } from '../notes/local/account'
import { collectionList } from '@astronote/schemas'

export const defaultCollection = 'Notes'

function uniqueNames(names: string[]) {
  const seen = new Set<string>()
  return names.filter(name => {
    const normalized = name.toLocaleLowerCase()
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  }).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

type CollectionKey = 'active' | 'catalog' | 'pending' | 'pending-delete'

function key(kind: CollectionKey, ownerId = activeAccountId() ?? 'guest') {
  return `astronote-collections:${kind}:${ownerId}`
}

function values(kind: Exclude<CollectionKey, 'active'>, ownerId?: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(kind, ownerId)) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && !!value.trim()) : []
  } catch { return [] }
}

/** Returns locally known collections; note-derived names are merged by the caller after loading notes. */
export function savedCollections() {
  return values('catalog')
}

export function activeCollection() {
  return localStorage.getItem(key('active'))?.trim() || defaultCollection
}

export function saveActiveCollection(collection: string) {
  localStorage.setItem(key('active'), collection)
}

export function mergeCollections(discovered: string[]) {
  const collections = uniqueNames([defaultCollection, ...savedCollections(), ...discovered])
  localStorage.setItem(key('catalog'), JSON.stringify(collections))
  return collections
}

export function addCollection(existing: string[], value: string) {
  const name = value.trim().slice(0, 80)
  if (!name || existing.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) return null
  const collections = uniqueNames([...existing, name])
  localStorage.setItem(key('catalog'), JSON.stringify(collections))
  localStorage.setItem(key('pending'), JSON.stringify([...new Set([...values('pending'), name])]))
  return { name, collections }
}

export function removeCollection(existing: string[], value: string) {
  const normalized = value.toLocaleLowerCase()
  if (normalized === defaultCollection.toLocaleLowerCase() || !existing.some(item => item.toLocaleLowerCase() === normalized)) return null
  const collections = existing.filter(item => item.toLocaleLowerCase() !== normalized)
  localStorage.setItem(key('catalog'), JSON.stringify(collections))
  const pending = values('pending')
  const wasPending = pending.some(item => item.toLocaleLowerCase() === normalized)
  localStorage.setItem(key('pending'), JSON.stringify(pending.filter(item => item.toLocaleLowerCase() !== normalized)))
  if (activeAccountId() && !wasPending) localStorage.setItem(key('pending-delete'),
    JSON.stringify(uniqueNames([...values('pending-delete'), value])))
  return collections
}

/** Moves guest-only collection metadata into the account that adopts the guest workspace. */
export function activateCollections(ownerId: string) {
  const guestCatalog = values('catalog', 'guest')
  const guestPending = values('pending', 'guest')
  if (guestCatalog.length || guestPending.length) {
    localStorage.setItem(key('catalog', ownerId), JSON.stringify(uniqueNames([...values('catalog', ownerId), ...guestCatalog])))
    localStorage.setItem(key('pending', ownerId), JSON.stringify(uniqueNames([...values('pending', ownerId), ...guestPending])))
  }
  const guestActive = localStorage.getItem(key('active', 'guest'))
  if (guestActive && !localStorage.getItem(key('active', ownerId))) localStorage.setItem(key('active', ownerId), guestActive)
  for (const kind of ['catalog', 'pending', 'pending-delete', 'active'] as const) localStorage.removeItem(key(kind, 'guest'))
}

/** Pushes queued catalog changes, then replaces local catalog state with the server result. */
export async function syncCollections(ownerId: string) {
  for (const name of values('pending-delete', ownerId)) {
    const response = await fetch(`/api/collections/${encodeURIComponent(name)}`, { method: 'DELETE',
      headers: { 'x-astronote-request': '1' } })
    if (!response.ok) {
      if (response.status === 409) localStorage.setItem(key('pending-delete', ownerId), JSON.stringify(
        values('pending-delete', ownerId).filter(item => item.toLocaleLowerCase() !== name.toLocaleLowerCase())))
      throw new Error(response.status === 409 ? 'Move or delete this collection’s notes first.' : `Collection delete failed (${response.status})`)
    }
    localStorage.setItem(key('pending-delete', ownerId), JSON.stringify(
      values('pending-delete', ownerId).filter(item => item.toLocaleLowerCase() !== name.toLocaleLowerCase())))
  }
  for (const name of values('pending', ownerId)) {
    const response = await fetch('/api/collections', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-astronote-request': '1' }, body: JSON.stringify({ name }) })
    if (!response.ok) throw new Error(`Collection push failed (${response.status})`)
    const pending = values('pending', ownerId).filter(item => item.toLocaleLowerCase() !== name.toLocaleLowerCase())
    localStorage.setItem(key('pending', ownerId), JSON.stringify(pending))
  }
  const response = await fetch('/api/collections', { cache: 'no-store' })
  if (!response.ok) throw new Error(`Collection pull failed (${response.status})`)
  const remote = collectionList.parse(await response.json()).collections.map(item => item.name)
  const deleted = new Set(values('pending-delete', ownerId).map(name => name.toLocaleLowerCase()))
  const collections = uniqueNames([defaultCollection, ...remote, ...values('pending', ownerId)])
    .filter(name => !deleted.has(name.toLocaleLowerCase()))
  localStorage.setItem(key('catalog', ownerId), JSON.stringify(collections))
  return collections
}
