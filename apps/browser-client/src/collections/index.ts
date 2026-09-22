import { activeAccountId } from '../notes/local'

export const defaultCollection = 'Notes'

function key(kind: 'active' | 'catalog') {
  return `astronote-collections:${kind}:${activeAccountId() ?? 'guest'}`
}

/** Returns locally known collections; note-derived names are merged by the caller after loading notes. */
export function savedCollections() {
  try {
    const values = JSON.parse(localStorage.getItem(key('catalog')) ?? '[]') as unknown
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && !!value.trim()) : []
  } catch { return [] }
}

export function activeCollection() {
  return localStorage.getItem(key('active'))?.trim() || defaultCollection
}

export function saveActiveCollection(collection: string) {
  localStorage.setItem(key('active'), collection)
}

export function mergeCollections(discovered: string[]) {
  const collections = [...new Set([defaultCollection, ...savedCollections(), ...discovered])]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  localStorage.setItem(key('catalog'), JSON.stringify(collections))
  return collections
}

export function addCollection(existing: string[], value: string) {
  const name = value.trim().slice(0, 80)
  if (!name || existing.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) return null
  const collections = [...existing, name].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  localStorage.setItem(key('catalog'), JSON.stringify(collections))
  return { name, collections }
}
