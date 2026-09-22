import assert from 'node:assert/strict'
import test from 'node:test'
import { accountKey } from '../src/notes/local/account.ts'
import { activateCollections, addCollection, removeCollection, savedCollections, syncCollections } from '../src/collections/index.ts'

function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) }, clear: () => data.clear(), key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size } } satisfies Storage
}

test('an offline-created empty collection is pushed and merged with the remote catalog', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() })
  localStorage.setItem(accountKey, 'account-1')
  assert.deepEqual(addCollection(['Notes'], 'projects'), { name: 'projects', collections: ['Notes', 'projects'] })
  const requests: { method: string; body?: string }[] = []
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: string, init?: RequestInit) => {
    requests.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined })
    return init?.method === 'POST' ? Response.json({ name: 'Projects' }, { status: 201 }) :
      Response.json({ collections: [{ name: 'Notes' }, { name: 'Projects' }, { name: 'Shared' }] })
  } })
  assert.deepEqual(await syncCollections('account-1'), ['Notes', 'Projects', 'Shared'])
  await syncCollections('account-1')
  assert.equal(requests.filter(request => request.method === 'POST').length, 1)
  assert.equal(requests[0]?.body, JSON.stringify({ name: 'projects' }))
})

test('guest empty collections follow guest notes into a connected account', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() })
  addCollection(['Notes'], 'Personal')
  activateCollections('account-2')
  localStorage.setItem(accountKey, 'account-2')
  assert.deepEqual(savedCollections(), ['Notes', 'Personal'])
  assert.equal(localStorage.getItem('astronote-collections:pending:account-2'), JSON.stringify(['Personal']))
  assert.equal(localStorage.getItem('astronote-collections:catalog:guest'), null)
})

test('an offline collection deletion is pushed once and removed from the catalog', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() })
  localStorage.setItem(accountKey, 'account-3')
  localStorage.setItem('astronote-collections:catalog:account-3', JSON.stringify(['Notes', 'Personal', 'Projects']))
  assert.deepEqual(removeCollection(['Notes', 'Personal', 'Projects'], 'Personal'), ['Notes', 'Projects'])
  assert.equal(removeCollection(['Notes', 'Projects'], 'Notes'), null)
  const requests: { url: string; method: string }[] = []
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? 'GET' })
    return init?.method === 'DELETE' ? new Response(null, { status: 204 }) :
      Response.json({ collections: [{ name: 'Notes' }, { name: 'Projects' }] })
  } })
  assert.deepEqual(await syncCollections('account-3'), ['Notes', 'Projects'])
  await syncCollections('account-3')
  assert.deepEqual(requests.filter(request => request.method === 'DELETE'),
    [{ url: '/api/collections/Personal', method: 'DELETE' }])
})

test('deleting an offline-created collection cancels its pending creation', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() })
  localStorage.setItem(accountKey, 'account-4')
  const added = addCollection(['Notes'], 'Temporary')
  assert.ok(added)
  assert.deepEqual(removeCollection(added.collections, 'temporary'), ['Notes'])
  assert.equal(localStorage.getItem('astronote-collections:pending:account-4'), JSON.stringify([]))
  assert.equal(localStorage.getItem('astronote-collections:pending-delete:account-4'), null)
})
