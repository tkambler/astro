import { pullResult, pushResult } from '@astronote/schemas'
import { acceptConflict, acceptPush, activeAccountId, getCursor, getGeneration, pendingMutations,
  receiveNotes, resetLocalNotes, setCursor } from '../local'
import { useAccount } from '../../account'
import { nextPushBatch } from './batch'
import { clearCachedAttachments } from '../../attachments'
export { watchRemoteChanges } from './changes'

export type SyncProgress = { completed: number; total: number }

let inFlight: Promise<{ pushed: number; pulled: number }> | undefined
let inFlightAccount: string | null = null
let requestedAgain = false
let resetInProgress = false
let resetVersion = 0
let syncAbort: AbortController | undefined

function validGeneration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid note generation from server')
  return value
}

/** Clears this workspace after the server has permanently reset its notes. */
export async function resetAllNotes() {
  if (resetInProgress) throw new Error('A note reset is already in progress')
  const accountId = activeAccountId()
  if (accountId && (useAccount.getState().status !== 'signed-in' || useAccount.getState().account?.id !== accountId))
    throw new Error('Sign in and reconnect before resetting notes for this account.')
  resetInProgress = true
  resetVersion++
  syncAbort?.abort()
  try {
    await inFlight?.catch(() => undefined)
    if (!accountId) {
      if (activeAccountId() !== null) throw new Error('Account changed during reset')
      await resetLocalNotes('guest', 0)
      return
    }
    const response = await fetch('/api/notes', { method: 'DELETE', headers: { 'x-astronote-request': '1' } })
    if (!response.ok) throw new Error(response.status === 401
      ? 'Sign in before resetting notes.' : 'Could not delete notes from the server. No local notes were removed.')
    const { generation } = await response.json() as { generation: unknown }
    if (activeAccountId() !== accountId) throw new Error('Account changed during reset')
    try { await resetLocalNotes(accountId, validGeneration(generation)); await clearCachedAttachments(accountId) }
    catch { throw new Error('Server notes were deleted, but this device could not clear its copy. Reconnect to finish the reset.') }
  } finally { resetInProgress = false }
}

export function syncNotes(onProgress?: (progress: SyncProgress) => Promise<void>,
  onNotesReceived?: () => Promise<void>): Promise<{ pushed: number; pulled: number }> {
  const accountId = activeAccountId()
  if (!accountId || resetInProgress) return Promise.resolve({ pushed: 0, pulled: 0 })
  if (inFlight && inFlightAccount !== accountId) return inFlight.then(() => syncNotes(onProgress, onNotesReceived))
  if (!inFlight) {
    inFlightAccount = accountId
    const version = resetVersion
    const controller = new AbortController()
    syncAbort = controller
    inFlight = (async () => {
      const totals = { pushed: 0, pulled: 0 }
      do {
        requestedAgain = false
        const result = await performSync(accountId, onProgress, onNotesReceived, controller.signal, version)
        totals.pushed += result.pushed
        totals.pulled += result.pulled
      } while (requestedAgain && activeAccountId() === accountId && resetVersion === version)
      return totals
    })().finally(() => { inFlight = undefined; inFlightAccount = null; requestedAgain = false; syncAbort = undefined })
  } else requestedAgain = true
  return inFlight
}

async function performSync(accountId: string, onProgress: ((progress: SyncProgress) => Promise<void>) | undefined,
  onNotesReceived: (() => Promise<void>) | undefined, signal: AbortSignal, version: number) {
  const stillActive = () => activeAccountId() === accountId && resetVersion === version && !signal.aborted
  const reconcileGeneration = async () => {
    const state = await fetch('/api/notes/state', { cache: 'no-store', signal })
    if (!state.ok) throw new Error(`Note state check failed (${state.status})`)
    const generation = validGeneration((await state.json() as { generation: unknown }).generation)
    if (!stillActive()) return null
    const local = await getGeneration(accountId)
    if (generation < local) throw new Error('Server note generation is older than this device')
    if (generation !== local) { await resetLocalNotes(accountId, generation); await clearCachedAttachments(accountId) }
    return generation
  }
  const generation = await reconcileGeneration()
  if (generation === null || !stillActive()) return { pushed: 0, pulled: 0 }
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
      headers: { 'content-type': 'application/json', 'x-astronote-request': '1',
        'x-astronote-generation': String(generation) }, body: batch.body, signal })
    if (response.status === 409) {
      if (await reconcileGeneration() === generation) throw new Error('Note generation changed during sync')
      requestedAgain = true
      return { pushed, pulled }
    }
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
    const response = await fetch(`/api/notes/changes?cursor=${cursor}`, { cache: 'no-store',
      headers: { 'x-astronote-generation': String(generation) }, signal })
    if (response.status === 409) {
      if (await reconcileGeneration() === generation) throw new Error('Note generation changed during sync')
      requestedAgain = true
      return { pushed, pulled }
    }
    if (!response.ok) throw new Error(`Pull failed (${response.status})`)
    const page = pullResult.parse(await response.json())
    if (!stillActive()) return { pushed, pulled }
    await receiveNotes(page.changes, accountId)
    pulled += page.changes.length
    if (!stillActive()) return { pushed, pulled }
    await setCursor(page.cursor, accountId)
    await onNotesReceived?.()
    hasMore = page.hasMore
  }
  return { pushed, pulled }
}
