import { pullResult, pushResult } from '@astronote/schemas'
import { acceptConflict, acceptPush, activeAccountId, getCursor, pendingMutations, receiveNote, setCursor } from '../local'
import { nextPushBatch } from './batch'
export { watchRemoteChanges } from './changes'

export type SyncProgress = { completed: number; total: number }

let inFlight: Promise<{ pushed: number; pulled: number }> | undefined
let inFlightAccount: string | null = null
let requestedAgain = false
export function syncNotes(onProgress?: (progress: SyncProgress) => Promise<void>): Promise<{ pushed: number; pulled: number }> {
  const accountId = activeAccountId()
  if (!accountId) return Promise.resolve({ pushed: 0, pulled: 0 })
  if (inFlight && inFlightAccount !== accountId) return inFlight.then(() => syncNotes(onProgress))
  if (!inFlight) {
    inFlightAccount = accountId
    inFlight = (async () => {
      const totals = { pushed: 0, pulled: 0 }
      do {
        requestedAgain = false
        const result = await performSync(accountId, onProgress)
        totals.pushed += result.pushed
        totals.pulled += result.pulled
      } while (requestedAgain && activeAccountId() === accountId)
      return totals
    })().finally(() => { inFlight = undefined; inFlightAccount = null; requestedAgain = false })
  } else requestedAgain = true
  return inFlight
}

async function performSync(accountId: string, onProgress?: (progress: SyncProgress) => Promise<void>) {
  const stillActive = () => activeAccountId() === accountId
  let pushed = 0
  let pulled = 0
  let completed = 0
  let pending = await pendingMutations(accountId)
  let total = pending.length
  if (total) await onProgress?.({ completed, total })
  while (pending.length) {
    if (!stillActive()) return { pushed, pulled }
    const batch = nextPushBatch(pending)
    const response = await fetch('/api/notes/push', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-astronote-request': '1' }, body: batch.body })
    if (response.status === 413) throw new Error('This note is too large to sync. It remains saved on this device.')
    if (!response.ok) throw new Error(`Push failed (${response.status})`)
    const results = pushResult.parse(await response.json()).results
    if (!stillActive()) return { pushed, pulled }
    if (results.length !== batch.mutations.length) throw new Error('Unexpected push result')
    for (const [index, mutation] of batch.mutations.entries()) {
      const result = results[index]
      if (!result || result.mutationId !== mutation.mutationId) throw new Error('Unexpected push result')
      if (result.status === 'applied') { await acceptPush(mutation, result.note, accountId); pushed++ }
      else await acceptConflict(mutation, result.serverNote, accountId)
      completed++
    }
    pending = await pendingMutations(accountId)
    total = Math.max(total, completed + pending.length)
    await onProgress?.({ completed, total })
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
