import { pullResult, pushResult } from '@astronote/schemas'
import { acceptConflict, acceptPush, activeAccountId, getCursor, pendingMutations, receiveNote, setCursor } from '../local'

let inFlight: Promise<{ pushed: number; pulled: number }> | undefined
let inFlightAccount: string | null = null
export function syncNotes(): Promise<{ pushed: number; pulled: number }> {
  const accountId = activeAccountId()
  if (!accountId) return Promise.resolve({ pushed: 0, pulled: 0 })
  if (inFlight && inFlightAccount !== accountId) return inFlight.then(() => syncNotes())
  if (!inFlight) {
    inFlightAccount = accountId
    inFlight = performSync(accountId).finally(() => { inFlight = undefined; inFlightAccount = null })
  }
  return inFlight
}

async function performSync(accountId: string) {
  const stillActive = () => activeAccountId() === accountId
  let pushed = 0
  let pulled = 0
  // Process one mutation at a time, so a later local edit uses the acknowledged base revision.
  for (let batch = await pendingMutations(accountId); batch.length; batch = await pendingMutations(accountId)) {
    if (!stillActive()) return { pushed, pulled }
    const mutation = batch[0]!
    const response = await fetch('/api/notes/push', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-astronote-request': '1' }, body: JSON.stringify({ mutations: [mutation] }) })
    if (response.status === 413) throw new Error('This note is too large to sync. It remains saved on this device.')
    if (!response.ok) throw new Error(`Push failed (${response.status})`)
    const result = pushResult.parse(await response.json()).results[0]
    if (!stillActive()) return { pushed, pulled }
    if (!result || result.mutationId !== mutation.mutationId) throw new Error('Unexpected push result')
    if (result.status === 'applied') { await acceptPush(mutation, result.note, accountId); pushed++ }
    else await acceptConflict(mutation, result.serverNote, accountId)
  }
  let hasMore = true
  while (hasMore) {
    if (!stillActive()) return { pushed, pulled }
    const cursor = await getCursor(accountId)
    const response = await fetch(`/api/notes/changes?cursor=${cursor}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Pull failed (${response.status})`)
    const page = pullResult.parse(await response.json())
    if (!stillActive()) return { pushed, pulled }
    for (const note of page.changes) {
      if (!stillActive()) return { pushed, pulled }
      await receiveNote(note, accountId); pulled++
    }
    if (!stillActive()) return { pushed, pulled }
    await setCursor(page.cursor, accountId)
    hasMore = page.hasMore
  }
  return { pushed, pulled }
}
